package family

// handlers.go — HTTP handlers for family endpoints.
// See architecture.md §8 for the API contract.

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

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

// PostInvite handles POST /v1/family/invites.
func (h *Handler) PostInvite(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)

	ctx := r.Context()
	userID := httpx.UserID(ctx)

	var req struct {
		InviteeEmail string `json:"inviteeEmail"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.InviteeEmail == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "inviteeEmail is required")
		return
	}

	// Caller must be in a family.
	q := gen.New(h.db)
	member, err := q.GetActiveFamilyMember(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "caller has no active family")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.invite: get caller family", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Get caller email for audit.
	callerUser, err := q.GetUserByID(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "family.invite: get caller user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	result, svcErr := h.svc.SendInvite(ctx, SendInviteParams{
		CallerUserID:   userID,
		CallerFamilyID: member.FamilyID,
		CallerEmail:    callerUser.Email,
		InviteeEmail:   req.InviteeEmail,
	})
	if svcErr != nil {
		switch {
		case errors.Is(svcErr, ErrFamilyFull):
			httpx.WriteError(w, r, http.StatusConflict, "family-full", "family has reached the maximum member limit")
		case errors.Is(svcErr, ErrDuplicateInvite):
			httpx.WriteError(w, r, http.StatusConflict, "duplicate-invite", "a pending invite already exists for this email")
		case errors.Is(svcErr, ErrNotAllowlisted):
			httpx.WriteError(w, r, http.StatusForbidden, "not-allowed", "invitee email is not on the allowlist")
		default:
			slog.WarnContext(ctx, "family.invite: send invite", "err", svcErr)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"inviteId":  result.InviteID,
		"expiresAt": result.ExpiresAt,
	})
}

// GetIncomingInvites handles GET /v1/family/invites/incoming.
func (h *Handler) GetIncomingInvites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)

	q := gen.New(h.db)
	callerUser, err := q.GetUserByID(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "family.invites.incoming: get user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	nowStr := httpx.FormatTime(nowUTC())
	invites, err := q.ListIncomingInvites(ctx, callerUser.Email, nowStr)
	if err != nil {
		slog.WarnContext(ctx, "family.invites.incoming: list", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	type inviteItem struct {
		InviteID     string `json:"inviteId"`
		FamilyID     string `json:"familyId"`
		InvitedBy    string `json:"invitedBy"`
		InviteeEmail string `json:"inviteeEmail"`
		CreatedAt    string `json:"createdAt"`
		ExpiresAt    string `json:"expiresAt"`
	}

	items := make([]inviteItem, 0, len(invites))
	for _, inv := range invites {
		items = append(items, inviteItem{
			InviteID:     inv.ID,
			FamilyID:     inv.FamilyID,
			InvitedBy:    inv.InvitedBy,
			InviteeEmail: inv.InviteeEmail,
			CreatedAt:    inv.CreatedAt,
			ExpiresAt:    inv.ExpiresAt,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"invites": items})
}

// PostAcceptInvite handles POST /v1/family/invites/{id}/accept.
func (h *Handler) PostAcceptInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)
	inviteID := chi.URLParam(r, "id")

	q := gen.New(h.db)
	callerUser, err := q.GetUserByID(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "family.accept: get user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	svcErr := h.svc.AcceptInvite(ctx, AcceptInviteParams{
		InviteID:     inviteID,
		CallerUserID: userID,
		CallerEmail:  callerUser.Email,
	})
	if svcErr != nil {
		switch {
		case errors.Is(svcErr, ErrInviteNotFound):
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "invite not found")
		case errors.Is(svcErr, ErrInviteNotPending):
			httpx.WriteError(w, r, http.StatusConflict, "invite-not-pending", "invite is not pending")
		case errors.Is(svcErr, ErrInviteExpired):
			httpx.WriteError(w, r, http.StatusConflict, "invite-expired", "invite has expired")
		case errors.Is(svcErr, ErrInviteEmailMismatch):
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "invite is not for this user")
		case errors.Is(svcErr, ErrNeedsMigrationDecision):
			httpx.WriteError(w, r, http.StatusConflict, "needs-migration-decision", "caller is already in a family")
		case errors.Is(svcErr, ErrFamilyFull):
			httpx.WriteError(w, r, http.StatusConflict, "family-full", "family has reached the maximum member limit")
		default:
			slog.WarnContext(ctx, "family.accept: accept invite", "err", svcErr)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		}
		return
	}

	// Load the invite to get familyID for SSE publish.
	if h.hub != nil {
		inv, err := q.GetFamilyInvite(ctx, inviteID)
		if err == nil {
			h.publishFamilyChanged(inv.FamilyID, "member_joined", userID)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// PostDeclineInvite handles POST /v1/family/invites/{id}/decline.
func (h *Handler) PostDeclineInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)
	inviteID := chi.URLParam(r, "id")

	q := gen.New(h.db)
	callerUser, err := q.GetUserByID(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "family.decline: get user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	svcErr := h.svc.DeclineInvite(ctx, DeclineInviteParams{
		InviteID:     inviteID,
		CallerUserID: userID,
		CallerEmail:  callerUser.Email,
	})
	if svcErr != nil {
		switch {
		case errors.Is(svcErr, ErrInviteNotFound):
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "invite not found")
		case errors.Is(svcErr, ErrInviteNotPending):
			httpx.WriteError(w, r, http.StatusConflict, "invite-not-pending", "invite is not pending")
		case errors.Is(svcErr, ErrInviteEmailMismatch):
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "invite is not for this user")
		default:
			slog.WarnContext(ctx, "family.decline: decline invite", "err", svcErr)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// migrateSoloRecordJSON is the per-record JSON shape in PostMigrateSolo.
type migrateSoloRecordJSON struct {
	RecordID           string `json:"recordId"`
	RecordType         string `json:"recordType"`
	Blob               string `json:"blob"` // base64url
	UpdatedAtMap       string `json:"updatedAtMap"`
	AddedByUser        string `json:"addedByUser"`
	EditedByUser       string `json:"editedByUser"`
	DeletedAt          string `json:"deletedAt"`
	PlaintextByteCount int64  `json:"plaintextByteCount"`
}

// PostMigrateSolo handles POST /v1/family/migrate-solo.
func (h *Handler) PostMigrateSolo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024) // 10 MB

	ctx := r.Context()
	userID := httpx.UserID(ctx)

	var req struct {
		MigrationID    string                  `json:"migrationId"`
		TargetFamilyID string                  `json:"targetFamilyId"`
		Records        []migrateSoloRecordJSON `json:"records"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.MigrationID == "" || req.TargetFamilyID == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "migrationId and targetFamilyId are required")
		return
	}

	// Caller must be in a (solo) source family.
	q := gen.New(h.db)
	sourceMember, err := q.GetActiveFamilyMember(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "caller has no active family")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.migrate-solo: get source family", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Look up caller email for the target-access check.
	callerUser, err := q.GetUserByID(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "family.migrate-solo: get caller user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Decode blobs.
	records := make([]MigrateSoloRecord, 0, len(req.Records))
	for i, rec := range req.Records {
		blobBytes, decErr := decodeBase64URL(rec.Blob)
		if decErr != nil {
			slog.WarnContext(ctx, "family.migrate-solo: decode blob", "index", i, "err", decErr)
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "record blob is not valid base64url")
			return
		}
		var deletedAt sql.NullString
		if rec.DeletedAt != "" {
			deletedAt = sql.NullString{String: rec.DeletedAt, Valid: true}
		}
		records = append(records, MigrateSoloRecord{
			RecordID:           rec.RecordID,
			RecordType:         rec.RecordType,
			Blob:               blobBytes,
			UpdatedAtMap:       rec.UpdatedAtMap,
			AddedByUser:        rec.AddedByUser,
			EditedByUser:       rec.EditedByUser,
			DeletedAt:          deletedAt,
			PlaintextByteCount: rec.PlaintextByteCount,
		})
	}

	result, svcErr := h.svc.MigrateSolo(ctx, MigrateSoloParams{
		MigrationID:    req.MigrationID,
		CallerUserID:   userID,
		CallerEmail:    callerUser.Email,
		SourceFamilyID: sourceMember.FamilyID,
		TargetFamilyID: req.TargetFamilyID,
		Records:        records,
	})
	if svcErr != nil {
		switch {
		case errors.Is(svcErr, ErrNotInTargetFamily):
			httpx.WriteError(w, r, http.StatusForbidden, "not-in-target-family", "caller is not a member of the target family")
		case errors.Is(svcErr, ErrSourceSameAsTarget):
			httpx.WriteError(w, r, http.StatusConflict, "source-same-as-target", "source family is the same as target family")
		default:
			slog.WarnContext(ctx, "family.migrate-solo: migrate", "err", svcErr)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"committedAt": result.CommittedAt,
		"recordCount": result.RecordCount,
	})
}

// PostLeave handles POST /v1/family/leave.
func (h *Handler) PostLeave(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4*1024)

	ctx := r.Context()
	userID := httpx.UserID(ctx)

	var req struct {
		TakeCopy bool `json:"takeCopy"`
	}
	// Ignore decode error — body is optional.
	_ = json.NewDecoder(r.Body).Decode(&req)

	// Caller must be in a family.
	q := gen.New(h.db)
	member, err := q.GetActiveFamilyMember(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "caller has no active family")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.leave: get family", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	callerUser, err := q.GetUserByID(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "family.leave: get user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	familyID := member.FamilyID

	svcErr := h.svc.Leave(ctx, LeaveParams{
		CallerUserID:   userID,
		CallerFamilyID: familyID,
		CallerEmail:    callerUser.Email,
	})
	if svcErr != nil {
		slog.WarnContext(ctx, "family.leave: service leave", "err", svcErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Publish SSE: notify remaining family members + the leaving user.
	if h.hub != nil {
		h.publishFamilyChanged(familyID, "member_left", userID)
		h.publishYouRemoved(userID, familyID, "left")
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"takeCopyExportUrl": nil,
	})
}

// PostRemoveMember handles POST /v1/family/members/{userId}/remove.
func (h *Handler) PostRemoveMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	callerUserID := httpx.UserID(ctx)
	targetUserID := chi.URLParam(r, "userId")

	q := gen.New(h.db)

	// Caller must be in a family.
	callerMember, err := q.GetActiveFamilyMember(ctx, callerUserID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "caller has no active family")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.remove: get caller family", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	callerUser, err := q.GetUserByID(ctx, callerUserID)
	if err != nil {
		slog.WarnContext(ctx, "family.remove: get caller user", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	svcErr := h.svc.RemoveMember(ctx, RemoveMemberParams{
		CallerUserID:   callerUserID,
		CallerFamilyID: callerMember.FamilyID,
		CallerJoinedAt: callerMember.JoinedAt,
		CallerEmail:    callerUser.Email,
		TargetUserID:   targetUserID,
	})
	if svcErr != nil {
		switch {
		case errors.Is(svcErr, ErrNotSameFamily):
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "target user is not in your family")
		case errors.Is(svcErr, ErrCoolDown):
			httpx.WriteError(w, r, http.StatusTooManyRequests, "cool-down", "remove cool-down has not elapsed")
		case errors.Is(svcErr, ErrTieBreakDenied):
			httpx.WriteError(w, r, http.StatusForbidden, "tie-break-denied", "caller joined after target; remove denied")
		default:
			slog.WarnContext(ctx, "family.remove: service remove", "err", svcErr)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		}
		return
	}

	familyID := callerMember.FamilyID

	// Publish SSE events.
	if h.hub != nil {
		h.publishYouRemoved(targetUserID, familyID, "kicked")
		h.publishFamilyChanged(familyID, "member_removed", targetUserID)
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// SSE helpers
// --------------------------------------------------------------------------

// familyChangedPayload is the JSON payload for the "family.changed" SSE event.
type familyChangedPayload struct {
	Kind   string `json:"kind"`
	UserID string `json:"userId"`
}

// youRemovedPayload is the JSON payload for the "you.removed" SSE event.
type youRemovedPayload struct {
	FamilyID string `json:"familyId"`
	Reason   string `json:"reason"`
}

// publishFamilyChanged emits a "family.changed" event to the family scope.
func (h *Handler) publishFamilyChanged(familyID, kind, userID string) {
	data, err := json.Marshal(familyChangedPayload{Kind: kind, UserID: userID})
	if err != nil {
		slog.Warn("family: marshal family.changed payload failed", "err", err)
		return
	}
	h.hub.Publish("family:"+familyID, live.Event{Type: "family.changed", Data: data})
}

// publishYouRemoved emits a "you.removed" event to the target user's scope.
func (h *Handler) publishYouRemoved(targetUserID, familyID, reason string) {
	data, err := json.Marshal(youRemovedPayload{FamilyID: familyID, Reason: reason})
	if err != nil {
		slog.Warn("family: marshal you.removed payload failed", "err", err)
		return
	}
	h.hub.Publish("user:"+targetUserID, live.Event{Type: "you.removed", Data: data})
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
