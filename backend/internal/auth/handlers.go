package auth

// HTTP handlers for the authentication endpoints (POST /v1/auth/google,
// POST /v1/auth/signout, POST /v1/auth/signout-all).
// See architecture.md §6.2 for the API contract.

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

// Handler holds dependencies for auth HTTP endpoints.
type Handler struct {
	db       *sql.DB
	verifier Verifier
	hub      *live.Hub // optional; nil disables SSE publish
}

// NewHandler constructs an auth Handler.
func NewHandler(db *sql.DB, verifier Verifier) *Handler {
	return &Handler{db: db, verifier: verifier}
}

// SetHub wires the SSE hub into the handler for device.joined notifications.
// Must be called before the server starts serving requests.
func (h *Handler) SetHub(hub *live.Hub) {
	h.hub = hub
}

// googleSignInRequest is the JSON body for POST /v1/auth/google.
type googleSignInRequest struct {
	IDToken      string  `json:"idToken"`
	DevicePubKey *string `json:"devicePubKey"` // base64-encoded X25519 public key or null
	DeviceLabel  string  `json:"deviceLabel"`
	UserAgent    string  `json:"userAgent"`
}

// signInUserResponse is the sub-object returned inside the sign-in response.
type signInUserResponse struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	IsAdmin     bool   `json:"isAdmin"`
	IsRoot      bool   `json:"isRoot"`
}

// signInDeviceResponse is the sub-object returned inside the sign-in response.
type signInDeviceResponse struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// signInResponse is the JSON body returned by POST /v1/auth/google.
type signInResponse struct {
	User             signInUserResponse   `json:"user"`
	Device           signInDeviceResponse `json:"device"`
	NeedsFamilyInit  bool                 `json:"needsFamilyInit"`
	AwaitingEnvelope bool                 `json:"awaitingEnvelope"`
}

// PostGoogle handles POST /v1/auth/google.
// It verifies the Google ID token, upserts the user + device, mints a session
// cookie, and returns user+device info to the client.
func (h *Handler) PostGoogle(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

	var req googleSignInRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}

	if req.IDToken == "" || req.DeviceLabel == "" || req.UserAgent == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "idToken, deviceLabel and userAgent are required")
		return
	}

	ctx := r.Context()
	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)

	// Verify the Google ID token.
	claims, err := h.verifier.Verify(ctx, req.IDToken)
	if err != nil {
		if errors.Is(err, ErrInvalidIDToken) {
			_ = insertAudit(ctx, h.db, "", "", "auth.signin.fail", "token", "", nowStr)
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-id-token", "")
			return
		}
		slog.WarnContext(ctx, "id token verification error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	q := gen.New(h.db)

	// Determine if this sign-in should auto-promote to root.
	// bootstrap_state is written on every startup; ErrNoRows means a severe
	// misconfiguration — treat as no-auto-root.
	var shouldBeRoot bool
	bsState, bsErr := q.GetBootstrapState(ctx)
	if bsErr == nil {
		// Check whether there is already a root user with this email.
		currentRoot, rootErr := q.GetCurrentRoot(ctx)
		noCurrentRoot := errors.Is(rootErr, sql.ErrNoRows)
		if rootErr != nil && !noCurrentRoot {
			slog.WarnContext(ctx, "get current root error", "err", rootErr)
		}
		rootIsThisEmail := !noCurrentRoot && currentRoot.Email == claims.Email
		shouldBeRoot = bsState.BootstrapEmail == claims.Email && !rootIsThisEmail
	}

	// Check allowlist — unless this sign-in will auto-promote to root (the
	// allowlist entry is created inside the transaction below).
	if !shouldBeRoot {
		if err := CheckEmailAllowed(ctx, h.db, claims.Email); err != nil {
			if errors.Is(err, ErrEmailNotAllowed) {
				_ = insertAudit(ctx, h.db, "", claims.Email, "auth.signin.fail", "token", "", nowStr)
				httpx.WriteError(w, r, http.StatusForbidden, "email-not-allowed", "")
				return
			}
			slog.WarnContext(ctx, "allowlist check error", "err", err)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
			return
		}
	}

	// Phase B: Derive pub key bytes. Phase 2 will enforce 32-byte X25519.
	var pubKeyBytes []byte
	if req.DevicePubKey != nil {
		decoded, err := base64.StdEncoding.DecodeString(*req.DevicePubKey)
		if err != nil {
			// Try raw URL encoding as well.
			decoded, err = base64.RawURLEncoding.DecodeString(*req.DevicePubKey)
		}
		if err != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "devicePubKey is not valid base64")
			return
		}
		pubKeyBytes = decoded
	} else {
		pubKeyBytes = []byte{} // Phase 2 enforces non-empty 32-byte X25519
	}

	// Derive display name: prefer Google "name" claim, fall back to email local part.
	displayName := claims.Name
	if displayName == "" {
		if at := strings.IndexByte(claims.Email, '@'); at > 0 {
			displayName = claims.Email[:at]
		} else {
			displayName = claims.Email
		}
	}

	// Generate IDs for the new device (user ID is generated here but may be
	// replaced by the upsert's RETURNING id if the user already exists).
	newUserID := mustNewUUID()
	deviceID := mustNewUUID()

	// Per B4c: upsert user, insert device, AND mint the session inside the
	// same transaction. If session insert fails, the device row rolls back too
	// — so we never leave a stranded device with no usable session.
	var returnedUser gen.User
	var awaitingEnvelope bool
	var cookieVal string

	txErr := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		// Upsert the user. On conflict, preserve existing id; update
		// google_sub, display_name, last_signin_at.
		u, err := qt.UpsertUserByEmail(ctx, gen.UpsertUserByEmailParams{
			ID:           newUserID,
			Email:        claims.Email,
			GoogleSub:    sql.NullString{String: claims.Sub, Valid: true},
			DisplayName:  displayName,
			CreatedAt:    nowStr,
			LastSigninAt: sql.NullString{String: nowStr, Valid: true},
		})
		if err != nil {
			return err
		}
		returnedUser = u

		// Reject suspended users before creating a new device/session.
		if u.SuspendedAt.Valid && u.SuspendedAt.String != "" {
			return ErrUserSuspended
		}

		// Auto-promote to root if applicable.
		if shouldBeRoot {
			// Ensure the email is on the allowlist (FK: allowlist.added_by → users.id).
			allowed, err := qt.IsEmailAllowed(ctx, claims.Email)
			if err != nil {
				return err
			}
			if !allowed {
				if err := qt.AddAllowlistEntry(ctx, gen.AddAllowlistEntryParams{
					Email:   claims.Email,
					AddedBy: u.ID,
					AddedAt: nowStr,
					Note:    sql.NullString{String: "auto-bootstrap", Valid: true},
				}); err != nil {
					return err
				}
			}
			if err := qt.SetUserAsRoot(ctx, u.ID); err != nil {
				return err
			}
		}

		// Determine device status: new devices for users who already have an
		// active family are created as 'pending' so that an existing device
		// must upload the encrypted family key (envelope) before this device
		// becomes 'active'. First-time sign-in (no family yet) keeps 'active'.
		deviceStatus := "active"
		if member, lookupErr := qt.GetActiveFamilyMember(ctx, u.ID); lookupErr == nil && member.FamilyID != "" {
			// User already belongs to a family — new device must await envelope.
			deviceStatus = "pending"
			awaitingEnvelope = true
		}

		// Insert the device.
		if _, err := qt.InsertDevice(ctx, gen.InsertDeviceParams{
			ID:         deviceID,
			UserID:     u.ID,
			Label:      req.DeviceLabel,
			UserAgent:  sql.NullString{String: req.UserAgent, Valid: true},
			PubKey:     pubKeyBytes,
			Status:     deviceStatus,
			CreatedAt:  nowStr,
			LastSeenAt: sql.NullString{String: nowStr, Valid: true},
		}); err != nil {
			return err
		}

		// Mint the session inside the same tx so device + session are atomic.
		cv, _, err := MintWithQueries(ctx, qt, deviceID, now)
		if err != nil {
			return err
		}
		cookieVal = cv

		return nil
	})

	if txErr != nil {
		if errors.Is(txErr, ErrUserSuspended) {
			_ = insertAudit(ctx, h.db, "", claims.Email, "auth.signin.fail", "user", "", nowStr)
			httpx.WriteError(w, r, http.StatusForbidden, "suspended", "")
			return
		}
		slog.WarnContext(ctx, "sign-in tx error", "err", txErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Audit success.
	_ = insertAudit(ctx, h.db, returnedUser.ID, claims.Email, "auth.signin.success", "device", deviceID, nowStr)

	SetCookie(w, cookieVal)

	// Reload is_root/is_admin from the returned user, accounting for any
	// SetUserAsRoot call that happened inside the tx.
	isRoot := returnedUser.IsRoot != 0 || shouldBeRoot
	isAdmin := returnedUser.IsAdmin != 0 || shouldBeRoot

	// Determine whether the user still needs to initialise a family.
	// A user needs family init when they have no active family_members row.
	needsFamilyInit := true
	if member, lookupErr := q.GetActiveFamilyMember(ctx, returnedUser.ID); lookupErr == nil && member.FamilyID != "" {
		needsFamilyInit = false
	}

	// If this is a new pending device, publish a device.joined SSE event to
	// the user scope so existing active devices can offer the envelope upload.
	if awaitingEnvelope && h.hub != nil {
		type deviceJoinedPayload struct {
			DeviceID  string `json:"deviceId"`
			Label     string `json:"label"`
			CreatedAt string `json:"createdAt"`
			PubKey    string `json:"pubKey,omitempty"`
		}
		pubKeyB64u := base64.RawURLEncoding.EncodeToString(pubKeyBytes)
		if data, err := json.Marshal(deviceJoinedPayload{
			DeviceID:  deviceID,
			Label:     req.DeviceLabel,
			CreatedAt: nowStr,
			PubKey:    pubKeyB64u,
		}); err == nil {
			h.hub.Publish("user:"+returnedUser.ID, live.Event{
				Type: "device.joined",
				Data: data,
			})
		} else {
			slog.WarnContext(ctx, "auth: marshal device.joined payload failed", "err", err)
		}
	}

	httpx.WriteJSON(w, http.StatusOK, signInResponse{
		User: signInUserResponse{
			ID:          returnedUser.ID,
			Email:       returnedUser.Email,
			DisplayName: returnedUser.DisplayName,
			IsAdmin:     isAdmin,
			IsRoot:      isRoot,
		},
		Device:           signInDeviceResponse{ID: deviceID, Label: req.DeviceLabel},
		NeedsFamilyInit:  needsFamilyInit,
		AwaitingEnvelope: awaitingEnvelope,
	})
}

// PostSignout handles POST /v1/auth/signout.
// Revokes the current session and clears the cookie.
func (h *Handler) PostSignout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := httpx.SessionID(ctx)
	if sessionID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	now := time.Now().UTC()
	if err := Revoke(ctx, h.db, sessionID, now); err != nil {
		slog.WarnContext(ctx, "revoke session error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	ClearCookie(w)

	userID := httpx.UserID(ctx)
	email := "" // not available directly in ctx; omit from audit detail
	_ = insertAudit(ctx, h.db, userID, email, "auth.signout", "session", sessionID, httpx.FormatTime(now))

	w.WriteHeader(http.StatusNoContent)
}

// PostSignoutAll handles POST /v1/auth/signout-all.
// Revokes all sessions for the current user and clears the cookie.
func (h *Handler) PostSignoutAll(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)
	if userID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	now := time.Now().UTC()
	if err := RevokeAll(ctx, h.db, userID, now); err != nil {
		slog.WarnContext(ctx, "revoke-all sessions error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	ClearCookie(w)

	_ = insertAudit(ctx, h.db, userID, "", "auth.signout.all", "user", userID, httpx.FormatTime(now))

	w.WriteHeader(http.StatusNoContent)
}

// ---- helpers ----------------------------------------------------------------

// insertAudit writes a single audit_log row. Errors are swallowed by callers
// (non-fatal) but still logged.
func insertAudit(ctx context.Context, db *sql.DB, actorUserID, actorEmail, action, targetKind, targetID, createdAt string) error {
	q := gen.New(db)
	id := mustNewUUID()
	return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          id,
		ActorUserID: nullString(actorUserID),
		ActorEmail:  nullString(actorEmail),
		Action:      action,
		TargetKind:  nullString(targetKind),
		TargetID:    nullString(targetID),
		DetailJson:  sql.NullString{},
		CreatedAt:   createdAt,
	})
}

// mustNewUUID generates a UUID v7 string, panicking on error (crypto/rand failure).
func mustNewUUID() string {
	id, err := uuid.NewV7()
	if err != nil {
		panic("uuid.NewV7: " + err.Error())
	}
	return id.String()
}

// nullString returns a NullString that is Valid only when s is non-empty.
func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

