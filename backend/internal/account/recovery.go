package account

// recovery.go — HTTP handlers for the recovery phrase endpoints.
//
//   POST /v1/account/recovery/reveal      — reveal the encrypted recovery phrase
//                                           ciphertext; requires a reauth grant.
//   POST /v1/account/recovery/regenerate  — replace both recovery envelopes;
//                                           requires a reauth grant.
//
// See architecture.md §6.2 and §8.12 for the API contract.

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// ErrInternal is returned by validateReauthGrant when a DB error occurs,
// so callers can distinguish infrastructure failures from auth failures.
var ErrInternal = errors.New("internal")

const (
	// reauthGrantHeader is the request header carrying the grant ID.
	reauthGrantHeader = "X-Reauth-Grant"
	// reauthGrantPurpose is the purpose value required for both recovery endpoints.
	reauthGrantPurpose = "reveal_recovery_phrase"
)

// ---- request / response types -----------------------------------------------

// revealRecoveryResponse is returned by POST /v1/account/recovery/reveal.
type revealRecoveryResponse struct {
	PhraseCt string `json:"phraseCt"` // base64url AEAD ciphertext of the recovery phrase
	SaltB64  string `json:"saltB64"`  // base64url 16-byte Argon2id salt
}

// regenerateRecoveryRequest is the JSON body for POST /v1/account/recovery/regenerate.
type regenerateRecoveryRequest struct {
	RecoveryWrap string `json:"recoveryWrap"` // base64url — new Wrap(familyKey, kRecovery)
	PhraseCt     string `json:"phraseCt"`     // base64url — new AEAD(familyKey, phrase)
	Salt         string `json:"salt"`         // base64url — new 16-byte salt
	Version      int64  `json:"version"`      // envelope-suite version byte
}

// ---- handlers ---------------------------------------------------------------

// PostRecoveryReveal handles POST /v1/account/recovery/reveal.
// Session required. X-Reauth-Grant header required.
// Returns {phraseCt, saltB64} from the family's recovery envelope.
func (h *Handler) PostRecoveryReveal(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1024)

	ctx := r.Context()
	userID := httpx.UserID(ctx)
	sessionID := httpx.SessionID(ctx)
	if userID == "" || sessionID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	grantID := r.Header.Get(reauthGrantHeader)
	if grantID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "reauth-required", "X-Reauth-Grant header is missing")
		return
	}

	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)

	q := gen.New(h.db)

	// 1. Validate the grant: must exist, unused, belong to this session, correct purpose, not expired.
	if err := validateReauthGrant(ctx, q, grantID, sessionID, now); err != nil {
		if errors.Is(err, ErrInternal) {
			slog.WarnContext(ctx, "recovery.reveal: grant DB error", "err", err)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
			return
		}
		httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-grant", "invalid or expired reauthentication grant")
		return
	}

	// 2. Look up the user's active family membership.
	member, err := q.GetActiveFamilyMember(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusForbidden, "family-required", "user is not a member of an active family")
			return
		}
		slog.WarnContext(ctx, "recovery.reveal: get family member error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// 3. Fetch the recovery envelope.
	envelope, err := q.GetFamilyRecoveryEnvelope(ctx, member.FamilyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "recovery envelope not found")
			return
		}
		slog.WarnContext(ctx, "recovery.reveal: get envelope error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// 4. Mark grant used and audit-log inside a single tx.
	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)
		if err := qt.MarkReauthGrantUsed(ctx, gen.MarkReauthGrantUsedParams{
			UsedAt: sql.NullString{String: nowStr, Valid: true},
			ID:     grantID,
		}); err != nil {
			return err
		}
		return recoveryAudit(ctx, qt, userID, "recovery.phrase.reveal", "family", member.FamilyID, nowStr)
	}); err != nil {
		slog.WarnContext(ctx, "recovery.reveal: mark-used tx error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, revealRecoveryResponse{
		PhraseCt: base64.RawURLEncoding.EncodeToString(envelope.PhraseCt),
		SaltB64:  base64.RawURLEncoding.EncodeToString(envelope.Salt),
	})
}

// PostRecoveryRegenerate handles POST /v1/account/recovery/regenerate.
// Session required. X-Reauth-Grant header required.
// Body: {recoveryWrap, phraseCt, salt, version}.
// Atomically replaces the family_recovery_envelopes row and audit-logs the action.
func (h *Handler) PostRecoveryRegenerate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

	var req regenerateRecoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.RecoveryWrap == "" || req.PhraseCt == "" || req.Salt == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recoveryWrap, phraseCt and salt are required")
		return
	}

	ctx := r.Context()
	userID := httpx.UserID(ctx)
	sessionID := httpx.SessionID(ctx)
	if userID == "" || sessionID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	grantID := r.Header.Get(reauthGrantHeader)
	if grantID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "reauth-required", "X-Reauth-Grant header is missing")
		return
	}

	// Decode and validate blobs.
	recoveryWrap, err := decodeBase64URL(req.RecoveryWrap)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recoveryWrap is not valid base64url")
		return
	}
	if len(recoveryWrap) < 49 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recoveryWrap is too short (minimum 49 bytes)")
		return
	}

	phraseCt, err := decodeBase64URL(req.PhraseCt)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "phraseCt is not valid base64url")
		return
	}
	if len(phraseCt) < 49 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "phraseCt is too short (minimum 49 bytes)")
		return
	}

	salt, err := decodeBase64URL(req.Salt)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "salt is not valid base64url")
		return
	}
	if len(salt) != 16 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "salt must be exactly 16 bytes")
		return
	}

	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)

	q := gen.New(h.db)

	// 1. Validate the grant.
	if err := validateReauthGrant(ctx, q, grantID, sessionID, now); err != nil {
		if errors.Is(err, ErrInternal) {
			slog.WarnContext(ctx, "recovery.regenerate: grant DB error", "err", err)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
			return
		}
		httpx.WriteError(w, r, http.StatusUnauthorized, "invalid-grant", "invalid or expired reauthentication grant")
		return
	}

	// 2. Look up the user's active family membership.
	member, err := q.GetActiveFamilyMember(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusForbidden, "family-required", "user is not a member of an active family")
			return
		}
		slog.WarnContext(ctx, "recovery.regenerate: get family member error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// 3. Atomically mark grant used + replace envelope + audit.
	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)
		if err := qt.MarkReauthGrantUsed(ctx, gen.MarkReauthGrantUsedParams{
			UsedAt: sql.NullString{String: nowStr, Valid: true},
			ID:     grantID,
		}); err != nil {
			return err
		}
		if err := qt.ReplaceFamilyRecoveryEnvelope(ctx, gen.ReplaceFamilyRecoveryEnvelopeParams{
			RecoveryWrap: recoveryWrap,
			PhraseCt:     phraseCt,
			Version:      req.Version,
			Salt:         salt,
			FamilyID:     member.FamilyID,
		}); err != nil {
			return err
		}
		return recoveryAudit(ctx, qt, userID, "recovery.code.regenerate", "family", member.FamilyID, nowStr)
	}); err != nil {
		slog.WarnContext(ctx, "recovery.regenerate: tx error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ---- helpers ----------------------------------------------------------------

// validateReauthGrant checks that the grant exists, is unused, belongs to the
// given session, has the correct purpose, and has not expired.
//
// Returns ErrInternal (wrapped) for DB errors so callers can respond with 500.
// All auth-validation failures return a plain sentinel so callers respond with
// an opaque "invalid or expired reauthentication grant" 401 — no detail leak.
func validateReauthGrant(ctx context.Context, q *gen.Queries, grantID, sessionID string, now time.Time) error {
	grant, err := q.GetUnusedReauthGrant(ctx, grantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("not found or already used")
		}
		return fmt.Errorf("%w: get grant: %v", ErrInternal, err)
	}
	if grant.SessionID != sessionID {
		return errors.New("session mismatch")
	}
	if grant.Purpose != reauthGrantPurpose {
		return errors.New("purpose mismatch")
	}
	expiresAt, parseErr := httpx.ParseTime(grant.ExpiresAt)
	if parseErr != nil || now.After(expiresAt) {
		return errors.New("expired")
	}
	return nil
}

// recoveryAudit writes an audit_log row inside an existing transaction.
func recoveryAudit(ctx context.Context, qt *gen.Queries, actorUserID, action, targetKind, targetID, createdAt string) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return qt.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          id.String(),
		ActorUserID: nullString(actorUserID),
		Action:      action,
		TargetKind:  nullString(targetKind),
		TargetID:    nullString(targetID),
		DetailJson:  sql.NullString{},
		CreatedAt:   createdAt,
	})
}

// decodeBase64URL decodes a base64url string, trying raw (no padding) first,
// then padded.
func decodeBase64URL(s string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}
