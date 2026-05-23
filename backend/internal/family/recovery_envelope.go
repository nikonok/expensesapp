package family

// recovery_envelope.go — HTTP handler for GET /v1/family/recovery-envelope.
//
// This endpoint is used in the "cold recovery on a fresh device" path (§8.2).
// The client knows the 24-word phrase, derives kRecovery, and unwraps Envelope A
// locally. No reauth is needed here — this is the starting point of the recovery
// flow itself.
//
// See architecture.md §6.2 and §8.2 for the API contract.

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// recoveryEnvelopeResponse is the JSON body returned by GET /v1/family/recovery-envelope.
type recoveryEnvelopeResponse struct {
	RecoveryWrap string `json:"recoveryWrap"` // base64url — Wrap(familyKey, kRecovery)
	Salt         string `json:"salt"`         // base64url — 16-byte Argon2id salt
	Version      int64  `json:"version"`      // envelope-suite version byte
	FamilyId     string `json:"familyId"`     // UUID of the family (needed for AAD derivation)
	CreatedAt    string `json:"createdAt"`    // families.created_at in RFC3339Ms (needed for AAD derivation)
}

// GetRecoveryEnvelope handles GET /v1/family/recovery-envelope.
// Session + RequireFamilyMembership required.
// Returns recoveryWrap, salt, and version from the family's recovery envelope.
// No reauth is needed — the client uses this during cold-recovery before any
// session exists that could be reauthenticated.
func (h *Handler) GetRecoveryEnvelope(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	familyID := httpx.FamilyID(ctx)
	if familyID == "" {
		// Should never happen when RequireFamilyMembership middleware is applied.
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "")
		return
	}

	q := gen.New(h.db)
	envelope, err := q.GetFamilyRecoveryEnvelope(ctx, familyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "recovery envelope not found")
			return
		}
		slog.WarnContext(ctx, "recovery-envelope: get envelope error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	family, err := q.GetFamilyByID(ctx, familyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "family not found")
			return
		}
		slog.WarnContext(ctx, "recovery-envelope: get family error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, recoveryEnvelopeResponse{
		RecoveryWrap: base64.RawURLEncoding.EncodeToString(envelope.RecoveryWrap),
		Salt:         base64.RawURLEncoding.EncodeToString(envelope.Salt),
		Version:      envelope.Version,
		FamilyId:     family.ID,
		CreatedAt:    family.CreatedAt,
	})
}
