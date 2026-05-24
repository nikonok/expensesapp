package admin

// handlers.go — HTTP handlers for admin endpoints (Phase 10).
// Routes registered under /v1/admin/* behind RequireAdmin middleware.

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

// storageQuotaBytes is the per-family storage quota used to derive storageUsagePct.
// 100 MB per §3.3 (matches records.quota).
const storageQuotaBytes = 100 * 1024 * 1024

// defaultPageSize is the default number of items per page for list endpoints.
const defaultPageSize = 50

// maxPageSize caps list endpoints to prevent oversized responses.
const maxPageSize = 200

// Handler holds dependencies for admin HTTP endpoints.
type Handler struct {
	db  *sql.DB
	hub *live.Hub // may be nil in tests that don't exercise SSE
}

// NewHandler constructs an admin Handler.
func NewHandler(db *sql.DB, hub *live.Hub) *Handler {
	return &Handler{db: db, hub: hub}
}

// --------------------------------------------------------------------------
// Request / response types
// --------------------------------------------------------------------------

// adminUserResponse is one element in GET /v1/admin/users.
type adminUserResponse struct {
	ID               string  `json:"id"`
	Email            string  `json:"email"`
	DisplayName      string  `json:"displayName"`
	LastSignInAt     *string `json:"lastSignInAt"`
	SuspendedAt      *string `json:"suspendedAt"`
	IsAdmin          bool    `json:"isAdmin"`
	IsRoot           bool    `json:"isRoot"`
	PromoterID       *string `json:"promoterId"`
	StorageUsagePct  float64 `json:"storageUsagePct"`
	FamilyMemberCount int64  `json:"familyMemberCount"`
	DeviceCount      int64   `json:"deviceCount"`
	HasRecoveryCode  bool    `json:"hasRecoveryCode"`
	DeletePending    bool    `json:"deletePending"`
}

// paginatedUsersResponse wraps the user list with pagination metadata.
type paginatedUsersResponse struct {
	Items  []adminUserResponse `json:"items"`
	Limit  int64               `json:"limit"`
	Offset int64               `json:"offset"`
}

// allowlistResponse is one element in GET /v1/admin/allowlist.
type allowlistResponse struct {
	Email   string  `json:"email"`
	AddedBy string  `json:"addedBy"`
	AddedAt string  `json:"addedAt"`
	Note    *string `json:"note"`
}

// addAllowlistRequest is the body for POST /v1/admin/allowlist.
type addAllowlistRequest struct {
	Email string `json:"email"`
	Note  string `json:"note"`
}

// auditLogResponse is one element in GET /v1/admin/audit.
type auditLogResponse struct {
	ID          string  `json:"id"`
	ActorUserID *string `json:"actorUserId"`
	ActorEmail  *string `json:"actorEmail"`
	Action      string  `json:"action"`
	TargetKind  *string `json:"targetKind"`
	TargetID    *string `json:"targetId"`
	DetailJSON  *string `json:"detailJson"`
	CreatedAt   string  `json:"createdAt"`
}

// paginatedAuditResponse wraps the audit log with cursor pagination.
type paginatedAuditResponse struct {
	Items      []auditLogResponse `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}

// --------------------------------------------------------------------------
// Helper: current actor from context
// --------------------------------------------------------------------------

// actorInfo bundles the caller's ID and email fetched from DB.
type actorInfo struct {
	id    string
	email string
}

// getActor loads the caller's user row from the DB using the userID in context.
func (h *Handler) getActor(r *http.Request) (actorInfo, error) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)
	q := gen.New(h.db)
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return actorInfo{}, err
	}
	return actorInfo{id: u.ID, email: u.Email}, nil
}

// --------------------------------------------------------------------------
// GET /v1/admin/users
// --------------------------------------------------------------------------

// GetUsers handles GET /v1/admin/users.
//
// Query params: limit (default 50, max 200), offset (default 0).
//
// Response shape per §8.14:
//
//	{ id, email, displayName, lastSignInAt, suspendedAt, isAdmin, isRoot,
//	  promoterId, storageUsagePct, familyMemberCount, deviceCount,
//	  hasRecoveryCode, deletePending }
func (h *Handler) GetUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	limit := parseIntParam(r, "limit", defaultPageSize, maxPageSize)
	offset := parseIntParam(r, "offset", 0, 1<<62)

	q := gen.New(h.db)
	rows, err := q.ListAdminUsers(ctx, gen.ListAdminUsersParams{
		Limit:  int64(limit),
		Offset: int64(offset),
	})
	if err != nil {
		slog.WarnContext(ctx, "admin: list users error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	items := make([]adminUserResponse, 0, len(rows))
	for _, row := range rows {
		pct := 0.0
		if storageQuotaBytes > 0 {
			pct = float64(row.UsageBytes) / float64(storageQuotaBytes) * 100
		}
		item := adminUserResponse{
			ID:                row.ID,
			Email:             row.Email,
			DisplayName:       row.DisplayName,
			IsAdmin:           row.IsAdmin != 0,
			IsRoot:            row.IsRoot != 0,
			StorageUsagePct:   pct,
			FamilyMemberCount: row.FamilyMemberCount,
			DeviceCount:       row.DeviceCount,
			HasRecoveryCode:   row.HasRecoveryCode != 0,
			DeletePending:     row.DeleteAfter.Valid,
		}
		if row.LastSigninAt.Valid {
			item.LastSignInAt = &row.LastSigninAt.String
		}
		if row.SuspendedAt.Valid {
			item.SuspendedAt = &row.SuspendedAt.String
		}
		if row.PromoterID.Valid {
			item.PromoterID = &row.PromoterID.String
		}
		items = append(items, item)
	}

	httpx.WriteJSON(w, http.StatusOK, paginatedUsersResponse{
		Items:  items,
		Limit:  int64(limit),
		Offset: int64(offset),
	})
}

// --------------------------------------------------------------------------
// POST /v1/admin/users/{id}/suspend
// --------------------------------------------------------------------------

// PostSuspendUser handles POST /v1/admin/users/{id}/suspend.
func (h *Handler) PostSuspendUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	targetID := chi.URLParam(r, "id")

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	if targetID == actor.id {
		httpx.WriteError(w, r, http.StatusBadRequest, "cannot-suspend-self", "")
		return
	}

	now := httpx.FormatTime(time.Now())
	nowSQL := sql.NullString{String: now, Valid: true}

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		target, err := q.GetUserByID(ctx, targetID)
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return fmt.Errorf("get user: %w", err)
		}
		if target.IsRoot != 0 {
			return errForbidden
		}

		if err := q.MarkUserSuspended(ctx, gen.MarkUserSuspendedParams{
			SuspendedAt: nowSQL,
			ID:          targetID,
		}); err != nil {
			return fmt.Errorf("mark suspended: %w", err)
		}

		// Revoke all sessions for the suspended user.
		if err := q.RevokeAllUserSessions(ctx, gen.RevokeAllUserSessionsParams{
			RevokedAt: nowSQL,
			UserID:    targetID,
		}); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("new uuid: %w", err)
		}
		return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: sql.NullString{String: actor.id, Valid: true},
			ActorEmail:  sql.NullString{String: actor.email, Valid: true},
			Action:      "user.suspend",
			TargetKind:  sql.NullString{String: "user", Valid: true},
			TargetID:    sql.NullString{String: targetID, Valid: true},
			DetailJson:  sql.NullString{},
			CreatedAt:   now,
		})
	}); err != nil {
		if errors.Is(err, errNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "user not found")
			return
		}
		if errors.Is(err, errForbidden) {
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "cannot suspend root user")
			return
		}
		slog.WarnContext(ctx, "admin: suspend user error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// POST /v1/admin/users/{id}/unsuspend
// --------------------------------------------------------------------------

// PostUnsuspendUser handles POST /v1/admin/users/{id}/unsuspend.
func (h *Handler) PostUnsuspendUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	targetID := chi.URLParam(r, "id")

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	now := httpx.FormatTime(time.Now())

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		if _, err := q.GetUserByID(ctx, targetID); errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		} else if err != nil {
			return fmt.Errorf("get user: %w", err)
		}

		if err := q.UnsuspendUser(ctx, targetID); err != nil {
			return fmt.Errorf("unsuspend user: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("new uuid: %w", err)
		}
		return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: sql.NullString{String: actor.id, Valid: true},
			ActorEmail:  sql.NullString{String: actor.email, Valid: true},
			Action:      "user.unsuspend",
			TargetKind:  sql.NullString{String: "user", Valid: true},
			TargetID:    sql.NullString{String: targetID, Valid: true},
			DetailJson:  sql.NullString{},
			CreatedAt:   now,
		})
	}); err != nil {
		if errors.Is(err, errNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "user not found")
			return
		}
		slog.WarnContext(ctx, "admin: unsuspend user error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// GET /v1/admin/allowlist
// --------------------------------------------------------------------------

// GetAllowlist handles GET /v1/admin/allowlist.
func (h *Handler) GetAllowlist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := gen.New(h.db)
	entries, err := q.ListAllowlist(ctx)
	if err != nil {
		slog.WarnContext(ctx, "admin: list allowlist error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	items := make([]allowlistResponse, 0, len(entries))
	for _, e := range entries {
		item := allowlistResponse{
			Email:   e.Email,
			AddedBy: e.AddedBy,
			AddedAt: e.AddedAt,
		}
		if e.Note.Valid {
			item.Note = &e.Note.String
		}
		items = append(items, item)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// --------------------------------------------------------------------------
// POST /v1/admin/allowlist
// --------------------------------------------------------------------------

// PostAllowlist handles POST /v1/admin/allowlist.
func (h *Handler) PostAllowlist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, 4*1024)

	var req addAllowlistRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.Email == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "email is required")
		return
	}

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	now := httpx.FormatTime(time.Now())
	note := sql.NullString{}
	if req.Note != "" {
		note = sql.NullString{String: req.Note, Valid: true}
	}

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		if err := q.AddAllowlistEntry(ctx, gen.AddAllowlistEntryParams{
			Email:   req.Email,
			AddedBy: actor.id,
			AddedAt: now,
			Note:    note,
		}); err != nil {
			return fmt.Errorf("add allowlist entry: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("new uuid: %w", err)
		}
		detail := fmt.Sprintf(`{"email":%q}`, req.Email)
		return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: sql.NullString{String: actor.id, Valid: true},
			ActorEmail:  sql.NullString{String: actor.email, Valid: true},
			Action:      "allowlist.add",
			TargetKind:  sql.NullString{String: "allowlist", Valid: true},
			TargetID:    sql.NullString{String: req.Email, Valid: true},
			DetailJson:  sql.NullString{String: detail, Valid: true},
			CreatedAt:   now,
		})
	}); err != nil {
		slog.WarnContext(ctx, "admin: add allowlist entry error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// DELETE /v1/admin/allowlist/{email}
// --------------------------------------------------------------------------

// DeleteAllowlist handles DELETE /v1/admin/allowlist/{email}.
func (h *Handler) DeleteAllowlist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	email := chi.URLParam(r, "email")

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	now := httpx.FormatTime(time.Now())

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		if err := q.RemoveAllowlistEntry(ctx, email); err != nil {
			return fmt.Errorf("remove allowlist entry: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("new uuid: %w", err)
		}
		detail := fmt.Sprintf(`{"email":%q}`, email)
		return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: sql.NullString{String: actor.id, Valid: true},
			ActorEmail:  sql.NullString{String: actor.email, Valid: true},
			Action:      "allowlist.remove",
			TargetKind:  sql.NullString{String: "allowlist", Valid: true},
			TargetID:    sql.NullString{String: email, Valid: true},
			DetailJson:  sql.NullString{String: detail, Valid: true},
			CreatedAt:   now,
		})
	}); err != nil {
		slog.WarnContext(ctx, "admin: remove allowlist entry error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// POST /v1/admin/admins/{id}/promote
// --------------------------------------------------------------------------

// PostPromoteAdmin handles POST /v1/admin/admins/{id}/promote.
func (h *Handler) PostPromoteAdmin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	targetID := chi.URLParam(r, "id")

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		if _, err := q.GetUserByID(ctx, targetID); errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		} else if err != nil {
			return fmt.Errorf("get user: %w", err)
		}

		return PromoteToAdmin(ctx, q, actor.id, actor.email, targetID)
	}); err != nil {
		if errors.Is(err, errNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "user not found")
			return
		}
		slog.WarnContext(ctx, "admin: promote error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// POST /v1/admin/admins/{id}/demote
// --------------------------------------------------------------------------

// PostDemoteAdmin handles POST /v1/admin/admins/{id}/demote.
func (h *Handler) PostDemoteAdmin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	targetID := chi.URLParam(r, "id")

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		target, err := q.GetUserByID(ctx, targetID)
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return fmt.Errorf("get user: %w", err)
		}

		// Root can never be demoted.
		if target.IsRoot != 0 {
			return ErrCannotDemoteRoot
		}

		// Caller must be the root, or target must be in caller's subtree.
		callerUser, err := q.GetUserByID(ctx, actor.id)
		if err != nil {
			return fmt.Errorf("get caller: %w", err)
		}
		if callerUser.IsRoot == 0 {
			inSubtree, err := IsInSubtree(ctx, q, actor.id, targetID)
			if err != nil {
				return fmt.Errorf("subtree check: %w", err)
			}
			if !inSubtree {
				return ErrNotInSubtree
			}
		}

		return DemoteAdmin(ctx, q, actor.id, actor.email, targetID)
	}); err != nil {
		if errors.Is(err, errNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "user not found")
			return
		}
		if errors.Is(err, ErrCannotDemoteRoot) {
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "root user cannot be demoted")
			return
		}
		if errors.Is(err, ErrNotInSubtree) {
			httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "target is not in caller's subtree")
			return
		}
		slog.WarnContext(ctx, "admin: demote error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// GET /v1/admin/audit
// --------------------------------------------------------------------------

// GetAuditLog handles GET /v1/admin/audit.
//
// Query params: limit (default 50, max 200), cursor (opaque base64url string).
func (h *Handler) GetAuditLog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	limit := parseIntParam(r, "limit", defaultPageSize, maxPageSize)

	// Decode cursor — base64url-encoded audit_log.id (ULID/UUIDv7 lexicographic).
	afterID := ""
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		b, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid cursor")
			return
		}
		afterID = string(b)
	}

	q := gen.New(h.db)
	rows, err := q.ListAuditLog(ctx, gen.ListAuditLogParams{
		AfterID: afterID,
		Limit:   int64(limit) + 1, // fetch one extra to detect next page
	})
	if err != nil {
		slog.WarnContext(ctx, "admin: list audit log error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	items := make([]auditLogResponse, 0, len(rows))
	for _, row := range rows {
		item := auditLogResponse{
			ID:        row.ID,
			Action:    row.Action,
			CreatedAt: row.CreatedAt,
		}
		if row.ActorUserID.Valid {
			item.ActorUserID = &row.ActorUserID.String
		}
		if row.ActorEmail.Valid {
			item.ActorEmail = &row.ActorEmail.String
		}
		if row.TargetKind.Valid {
			item.TargetKind = &row.TargetKind.String
		}
		if row.TargetID.Valid {
			item.TargetID = &row.TargetID.String
		}
		if row.DetailJson.Valid {
			item.DetailJSON = &row.DetailJson.String
		}
		items = append(items, item)
	}

	resp := paginatedAuditResponse{Items: items}
	if hasMore && len(rows) > 0 {
		lastID := rows[len(rows)-1].ID
		cursor := base64.RawURLEncoding.EncodeToString([]byte(lastID))
		resp.NextCursor = &cursor
	}

	httpx.WriteJSON(w, http.StatusOK, resp)
}

// --------------------------------------------------------------------------
// POST /v1/admin/devices/{id}/revoke
// --------------------------------------------------------------------------

// PostRevokeDevice handles POST /v1/admin/devices/{id}/revoke.
// Admin force-revoke a device; emits device.revoked SSE to that device's scope.
func (h *Handler) PostRevokeDevice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	deviceID := chi.URLParam(r, "id")

	actor, err := h.getActor(r)
	if err != nil {
		slog.WarnContext(ctx, "admin: get actor error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	now := httpx.FormatTime(time.Now())
	nowSQL := sql.NullString{String: now, Valid: true}

	if err := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		q := gen.New(tx)

		if _, err := q.GetDeviceByID(ctx, deviceID); errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		} else if err != nil {
			return fmt.Errorf("get device: %w", err)
		}

		if err := q.RevokeDevice(ctx, gen.RevokeDeviceParams{
			RevokedAt:    nowSQL,
			RevokeReason: sql.NullString{String: "admin_revoke", Valid: true},
			ID:           deviceID,
		}); err != nil {
			return fmt.Errorf("revoke device: %w", err)
		}

		if err := q.RevokeAllDeviceSessions(ctx, gen.RevokeAllDeviceSessionsParams{
			RevokedAt: nowSQL,
			DeviceID:  deviceID,
		}); err != nil {
			return fmt.Errorf("revoke device sessions: %w", err)
		}

		auditID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("new uuid: %w", err)
		}
		return q.InsertAuditEntry(ctx, gen.InsertAuditEntryParams{
			ID:          auditID.String(),
			ActorUserID: sql.NullString{String: actor.id, Valid: true},
			ActorEmail:  sql.NullString{String: actor.email, Valid: true},
			Action:      "device.revoke.admin",
			TargetKind:  sql.NullString{String: "device", Valid: true},
			TargetID:    sql.NullString{String: deviceID, Valid: true},
			DetailJson:  sql.NullString{},
			CreatedAt:   now,
		})
	}); err != nil {
		if errors.Is(err, errNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "device not found")
			return
		}
		slog.WarnContext(ctx, "admin: revoke device error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Emit device.revoked SSE to the device scope (best-effort; ignore if hub nil).
	if h.hub != nil {
		payload, _ := json.Marshal(map[string]string{"deviceId": deviceID, "reason": "admin_revoke"})
		h.hub.Publish("device:"+deviceID, live.Event{Type: "device.revoked", Data: payload})
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// Sentinel errors (local to admin package)
// --------------------------------------------------------------------------

var errNotFound = errors.New("not found")
var errForbidden = errors.New("forbidden")
var errCannotSuspendSelf = errors.New("cannot suspend self")

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// parseIntParam reads a query parameter as int, falling back to defaultVal.
// The result is clamped to [0, maxVal].
func parseIntParam(r *http.Request, name string, defaultVal, maxVal int) int {
	s := r.URL.Query().Get(name)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return defaultVal
	}
	if v > maxVal {
		return maxVal
	}
	return v
}
