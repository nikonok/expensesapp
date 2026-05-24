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
// Touch strategy: TouchAndMaybeRotate is called synchronously BEFORE
// next.ServeHTTP so that Set-Cookie is written while headers are still mutable.
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

			// Touch / rotate before calling next so the Set-Cookie header is
			// written while the response headers are still mutable.
			newCookie, rotated, err := TouchAndMaybeRotate(r.Context(), db, info, now)
			if err == nil && rotated {
				SetCookie(w, newCookie)
			}

			ctx := httpx.WithUserID(r.Context(), info.UserID)
			ctx = httpx.WithDeviceID(ctx, info.DeviceID)
			ctx = httpx.WithSessionID(ctx, info.SessionID)
			next.ServeHTTP(w, r.WithContext(ctx))
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
