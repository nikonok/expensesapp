package auth

// Middleware chain for protected endpoints. See architecture.md §6.4.

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// SessionMiddleware reads the __Host-session cookie, validates it, and on
// success populates user/device IDs into the request context. On failure, it
// writes a 401 ProblemDetails and returns.
//
// Touch strategy: TouchAndMaybeRotate is called BEFORE next.ServeHTTP so that
// Set-Cookie can be queued while headers are still mutable, but the actual
// DB rotation is committed AFTER the handler returns successfully (B4d).
// A panic in the handler skips Commit, so the client keeps using its existing
// cookie and the previous-token-hash grace window is never burned.
// Trade-off: every authenticated request incurs a DB write. Acceptable at <50
// users; revisit when scaling.
func SessionMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(cookieName)
			if err != nil || cookie.Value == "" {
				w.Header().Set("Cache-Control", "no-store")
				httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
				return
			}

			now := time.Now().UTC()

			info, err := Validate(r.Context(), db, cookie.Value, now)
			if err != nil {
				w.Header().Set("Cache-Control", "no-store")
				if errors.Is(err, ErrInvalidSession) {
					httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
					return
				}
				slog.WarnContext(r.Context(), "session validation error", "err", err)
				httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
				return
			}

			// Best-effort: update devices.last_seen_at at most once per hour.
			// Never fails the request.
			if touchErr := TouchDeviceIfStale(r.Context(), db, info, now); touchErr != nil {
				slog.WarnContext(r.Context(), "touch device error", "err", touchErr)
			}

			// Prepare rotation (mints new token + queues a DB commit). The cookie
			// is set on the response so it ships back to the client, but Commit
			// is deferred until after next.ServeHTTP returns without panic.
			pending, rotErr := TouchAndMaybeRotate(r.Context(), db, info, now)
			if rotErr == nil && pending.Rotated {
				SetCookie(w, pending.NewCookieValue)
			} else if rotErr != nil {
				slog.WarnContext(r.Context(), "session touch/rotate error", "err", rotErr)
			}

			ctx := httpx.WithUserID(r.Context(), info.UserID)
			ctx = httpx.WithDeviceID(ctx, info.DeviceID)
			ctx = httpx.WithSessionID(ctx, info.SessionID)
			ctx = httpx.WithDeviceStatus(ctx, info.DeviceStatus)
			next.ServeHTTP(w, r.WithContext(ctx))

			// Commit the rotation only after the handler returns. A panic above
			// short-circuits this — the new cookie that went out is now bound to
			// the OLD token_hash (still valid in DB), so the client keeps working.
			if pending.Rotated {
				if commitErr := pending.Commit(r.Context()); commitErr != nil {
					slog.WarnContext(r.Context(), "session rotation commit error", "err", commitErr)
				}
			}
		})
	}
}

// CSRFHeaderGate rejects POST/PUT/PATCH/DELETE requests missing the
// "X-Requested-With: fetch" header with 403. SameSite=Lax + this header check
// gives defense-in-depth over CloudFlare's existing origin policy.
func CSRFHeaderGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("X-Requested-With") != "fetch" {
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "missing X-Requested-With header")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAdmin checks that the session user is an active admin or root.
// "Active" means is_admin=1 OR is_root=1, AND suspended_at IS NULL.
// On success it passes through; on failure it writes 403 admin-required.
//
// Requires SessionMiddleware to have run first (userID must be in context).
func RequireAdmin(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			userID := httpx.UserID(ctx)

			q := gen.New(db)
			u, err := q.GetUserByID(ctx, userID)
			if errors.Is(err, sql.ErrNoRows) {
				httpx.WriteError(w, r, http.StatusForbidden, "admin-required", "")
				return
			}
			if err != nil {
				slog.WarnContext(ctx, "RequireAdmin: get user error", "err", err)
				httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
				return
			}

			// Suspended admins are not admins.
			if u.SuspendedAt.Valid {
				httpx.WriteError(w, r, http.StatusForbidden, "admin-required", "account suspended")
				return
			}

			if u.IsAdmin == 0 && u.IsRoot == 0 {
				httpx.WriteError(w, r, http.StatusForbidden, "admin-required", "")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireActiveDevice rejects requests from a device whose status is not
// "active" (e.g. "pending", awaiting an envelope from an existing device).
// Pending devices can still authenticate (needed for /v1/sync/live and the
// join/envelope endpoints), but must not read or write family ciphertext via
// push/pull, nor list or trigger a snapshot restore, until they have the
// family key.
//
// Requires SessionMiddleware to have run first (device status must be in ctx).
func RequireActiveDevice(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if httpx.DeviceStatus(r.Context()) != "active" {
			httpx.WriteError(w, r, http.StatusForbidden, "device-not-active", "device must be active to sync")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireFamilyMembership loads the user's active family_members row and injects
// the familyId into the context. If the user has no active family, it returns
// 403 with error code "family-required".
//
// Requires SessionMiddleware to have run first (user ID must be in context).
func RequireFamilyMembership(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			userID := httpx.UserID(ctx)

			q := gen.New(db)
			member, err := q.GetActiveFamilyMember(ctx, userID)
			if errors.Is(err, sql.ErrNoRows) {
				httpx.WriteError(w, r, http.StatusForbidden, "family-required", "user is not a member of an active family")
				return
			}
			if err != nil {
				slog.WarnContext(ctx, "family membership lookup error", "err", err)
				httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
				return
			}

			ctx = httpx.WithFamilyID(ctx, member.FamilyID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
