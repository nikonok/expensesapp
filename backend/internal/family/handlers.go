package family

// handlers.go — HTTP handlers for POST /v1/family/init and family stubs.
// See architecture.md §8.1 for the API contract.

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

// errNotImplemented is the sentinel returned by Phase 7 stubs.
var errNotImplemented = errors.New("not implemented")

// errDeviceNotPending is returned when activating a device whose status is no
// longer 'pending' (e.g. a duplicate envelope POST or a race).
var errDeviceNotPending = errors.New("device not pending")

// nowUTC is a package-level variable so tests can override it.
var nowUTC = func() time.Time { return time.Now().UTC() }

// Handler holds dependencies for family HTTP endpoints.
type Handler struct {
	db  *sql.DB
	svc *Service
	hub *live.Hub // optional; nil disables SSE publish
}

// NewHandler constructs a family Handler.
func NewHandler(db *sql.DB) *Handler {
	return &Handler{
		db:  db,
		svc: NewService(db),
	}
}

// --------------------------------------------------------------------------
// Request / response types
// --------------------------------------------------------------------------

// initRecoveryRequest is the nested recovery object in initFamilyRequest.
type initRecoveryRequest struct {
	Wrap     string `json:"wrap"`
	PhraseCt string `json:"phraseCt"`
	Salt     string `json:"salt"`
}

// initFamilyRequest is the JSON body for POST /v1/family/init.
type initFamilyRequest struct {
	FamilyID       string              `json:"familyId"`
	DeviceEnvelope string              `json:"deviceEnvelope"`
	Recovery       initRecoveryRequest `json:"recovery"`
}

// initFamilyResponse is the JSON body returned by a successful POST /v1/family/init.
type initFamilyResponse struct {
	FamilyID string `json:"familyId"`
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------

// PostInit handles POST /v1/family/init.
// Creates a new family, seeds envelopes, and returns { "familyId": "..." }.
func (h *Handler) PostInit(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

	ctx := r.Context()
	userID := httpx.UserID(ctx)
	deviceID := httpx.DeviceID(ctx)

	var req initFamilyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}

	// Validate familyId: must parse as a valid UUID.
	if _, err := uuid.Parse(req.FamilyID); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "familyId must be a valid UUID v7")
		return
	}

	// Decode and validate deviceEnvelope: must be exactly 80 bytes (libsodium sealed-box).
	wrappedKey, err := decodeBase64URL(req.DeviceEnvelope)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "deviceEnvelope is not valid base64url")
		return
	}
	if len(wrappedKey) != 80 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "deviceEnvelope must be exactly 80 bytes")
		return
	}

	// Decode and validate recovery.wrap: must be ≥ 49 bytes.
	recoveryWrap, err := decodeBase64URL(req.Recovery.Wrap)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recovery.wrap is not valid base64url")
		return
	}
	if len(recoveryWrap) < 49 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recovery.wrap is too short (minimum 49 bytes)")
		return
	}

	// Decode and validate recovery.phraseCt: must be ≥ 49 bytes.
	phraseCt, err := decodeBase64URL(req.Recovery.PhraseCt)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recovery.phraseCt is not valid base64url")
		return
	}
	if len(phraseCt) < 49 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recovery.phraseCt is too short (minimum 49 bytes)")
		return
	}

	// Decode and validate recovery.salt: must be exactly 16 bytes.
	salt, err := decodeBase64URL(req.Recovery.Salt)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recovery.salt is not valid base64url")
		return
	}
	if len(salt) != 16 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "recovery.salt must be exactly 16 bytes")
		return
	}

	// Call service.
	initErr := h.svc.Init(ctx, InitParams{
		FamilyID:     req.FamilyID,
		DeviceID:     deviceID,
		UserID:       userID,
		WrappedKey:   wrappedKey,
		RecoveryWrap: recoveryWrap,
		PhraseCt:     phraseCt,
		Salt:         salt,
	})
	if errors.Is(initErr, ErrAlreadyInFamily) {
		httpx.WriteError(w, r, http.StatusConflict, "already-in-family", "")
		return
	}
	if initErr != nil {
		slog.WarnContext(ctx, "family.init error", "err", initErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, initFamilyResponse{FamilyID: req.FamilyID})
}

// PostInvite handles POST /v1/family/invites (Phase 7 stub).
func (h *Handler) PostInvite(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not-implemented", "")
}

// GetIncomingInvites handles GET /v1/family/invites/incoming.
// Returns an empty array in Phase 3 (no invites logic yet).
func (h *Handler) GetIncomingInvites(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"invites": []any{},
	})
}

// PostAcceptInvite handles POST /v1/family/invites/{id}/accept (Phase 7 stub).
func (h *Handler) PostAcceptInvite(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not-implemented", "")
}

// PostDeclineInvite handles POST /v1/family/invites/{id}/decline (Phase 7 stub).
func (h *Handler) PostDeclineInvite(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not-implemented", "")
}

// PostMigrateSolo handles POST /v1/family/migrate-solo (Phase 7 stub).
func (h *Handler) PostMigrateSolo(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not-implemented", "")
}

// PostLeave handles POST /v1/family/leave (Phase 7 stub).
func (h *Handler) PostLeave(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not-implemented", "")
}

// PostRemoveMember handles POST /v1/family/members/{userId}/remove (Phase 7 stub).
func (h *Handler) PostRemoveMember(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not-implemented", "")
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// decodeBase64URL decodes a base64url string, trying raw (no padding) first,
// then padded.
func decodeBase64URL(s string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}

// insertAudit writes a single audit_log row. Errors are non-fatal.
func insertAudit(ctx context.Context, db *sql.DB, actorUserID, actorEmail, action, targetKind, targetID, createdAt string) error {
	q := gen.New(db)
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
		ID:          id.String(),
		ActorUserID: nullString(actorUserID),
		ActorEmail:  nullString(actorEmail),
		Action:      action,
		TargetKind:  nullString(targetKind),
		TargetID:    nullString(targetID),
		DetailJson:  sql.NullString{},
		CreatedAt:   createdAt,
	})
}

// nullString returns a NullString that is Valid only when s is non-empty.
func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}
