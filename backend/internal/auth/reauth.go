package auth

// reauth.go — HTTP handlers for the reauth challenge/verify endpoints.
//
//   POST /v1/reauth/challenge  — issues a 60-second nonce bound to the session.
//   POST /v1/reauth/verify     — verifies a fresh Google ID token + nonce, mints
//                                a reauth_grant.
//
// See architecture.md §6.2 and §8.12 for the API contract.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

const (
	// reauthChallengeTTL is how long a nonce is valid for before it must be used.
	reauthChallengeTTL = 60 * time.Second
	// reauthGrantTTL is how long a minted reauth_grant is valid for use.
	reauthGrantTTL = 60 * time.Second
	// reauthGrantPurposeRevealPhrase is the purpose stored in reauth_grants.
	reauthGrantPurposeRevealPhrase = "reveal_recovery_phrase"
)

// ReauthHandler holds dependencies for the reauth endpoints.
// It reuses the same Verifier as the main auth flow.
type ReauthHandler struct {
	db       *sql.DB
	verifier Verifier
}

// NewReauthHandler constructs a ReauthHandler.
func NewReauthHandler(db *sql.DB, verifier Verifier) *ReauthHandler {
	return &ReauthHandler{db: db, verifier: verifier}
}

// ---- request / response types -----------------------------------------------

type challengeResponse struct {
	Nonce     string `json:"nonce"`
	ExpiresAt string `json:"expiresAt"`
}

type verifyReauthRequest struct {
	Nonce   string `json:"nonce"`
	IDToken string `json:"idToken"`
}

type verifyReauthResponse struct {
	GrantID   string `json:"grantId"`
	ExpiresAt string `json:"expiresAt"`
}

// ---- handlers ---------------------------------------------------------------

// PostChallenge handles POST /v1/reauth/challenge.
// Session required. Generates a 60s nonce bound to the current session.
func (h *ReauthHandler) PostChallenge(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1024)

	ctx := r.Context()
	sessionID := httpx.SessionID(ctx)
	if sessionID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	now := time.Now().UTC()
	expiresAt := now.Add(reauthChallengeTTL)
	nonce := mustNewUUID()

	q := gen.New(h.db)
	if err := q.InsertReauthChallenge(ctx, gen.InsertReauthChallengeParams{
		Nonce:     nonce,
		SessionID: sessionID,
		IssuedAt:  httpx.FormatTime(now),
		ExpiresAt: httpx.FormatTime(expiresAt),
	}); err != nil {
		slog.WarnContext(ctx, "reauth: insert challenge error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, challengeResponse{
		Nonce:     nonce,
		ExpiresAt: httpx.FormatTime(expiresAt),
	})
}

// PostVerify handles POST /v1/reauth/verify.
// Session required. Body: {nonce, idToken}. Verifies the Google ID token, checks
// that the token's sub matches the user's google_sub, marks the challenge as used,
// and mints a reauth_grant with purpose "reveal_recovery_phrase".
func (h *ReauthHandler) PostVerify(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)

	var req verifyReauthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.Nonce == "" || req.IDToken == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "nonce and idToken are required")
		return
	}

	ctx := r.Context()
	sessionID := httpx.SessionID(ctx)
	userID := httpx.UserID(ctx)
	if sessionID == "" || userID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)

	q := gen.New(h.db)

	// 1. Look up the challenge — must exist, unused, owned by this session.
	challenge, err := q.GetUnusedReauthChallenge(ctx, req.Nonce)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-nonce", "nonce not found or already used")
			return
		}
		slog.WarnContext(ctx, "reauth: get challenge error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}
	if challenge.SessionID != sessionID {
		httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-nonce", "nonce belongs to a different session")
		return
	}
	// Check expiry.
	expiresAt, parseErr := httpx.ParseTime(challenge.ExpiresAt)
	if parseErr != nil || now.After(expiresAt) {
		httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-nonce", "nonce has expired")
		return
	}

	// 2. Verify the Google ID token.
	claims, err := h.verifier.Verify(ctx, req.IDToken)
	if err != nil {
		if errors.Is(err, ErrInvalidIDToken) {
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-id-token", "")
			return
		}
		slog.WarnContext(ctx, "reauth: id token verification error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// 3. Check token sub matches the user's google_sub.
	user, err := q.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
			return
		}
		slog.WarnContext(ctx, "reauth: get user error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}
	if !user.GoogleSub.Valid || user.GoogleSub.String != claims.Sub {
		httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-id-token", "token subject does not match account")
		return
	}

	// 4. Atomically mark challenge used + insert grant.
	grantID := mustNewUUID()
	grantExpiresAt := now.Add(reauthGrantTTL)
	grantExpiresAtStr := httpx.FormatTime(grantExpiresAt)

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)
		if err := qt.MarkReauthChallengeUsed(ctx, gen.MarkReauthChallengeUsedParams{
			UsedAt: sql.NullString{String: nowStr, Valid: true},
			Nonce:  req.Nonce,
		}); err != nil {
			return err
		}
		return qt.InsertReauthGrant(ctx, gen.InsertReauthGrantParams{
			ID:        grantID,
			SessionID: sessionID,
			Purpose:   reauthGrantPurposeRevealPhrase,
			ExpiresAt: grantExpiresAtStr,
		})
	}); err != nil {
		slog.WarnContext(ctx, "reauth: mark+grant tx error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, verifyReauthResponse{
		GrantID:   grantID,
		ExpiresAt: grantExpiresAtStr,
	})
}
