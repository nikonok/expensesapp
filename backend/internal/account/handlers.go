// Package account owns the /v1/me and /v1/me/devices HTTP endpoints.
// See architecture.md §6.2 for the API contract.
package account

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

const rfc3339Ms = "2006-01-02T15:04:05.000Z07:00"

// Handler holds dependencies for account HTTP endpoints.
type Handler struct {
	db *sql.DB
}

// NewHandler constructs an account Handler.
func NewHandler(db *sql.DB) *Handler {
	return &Handler{db: db}
}

// meUserResponse is the user sub-object returned by GET /v1/me.
type meUserResponse struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	IsAdmin     bool   `json:"isAdmin"`
	IsRoot      bool   `json:"isRoot"`
}

// meDeviceResponse is the device sub-object returned by GET /v1/me.
type meDeviceResponse struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// meResponse is the JSON body returned by GET /v1/me.
type meResponse struct {
	User                 meUserResponse    `json:"user"`
	Device               meDeviceResponse  `json:"device"`
	Family               interface{}       `json:"family"`               // null in Phase 1
	NotificationSettings interface{}       `json:"notificationSettings"` // null in Phase 1
}

// deviceListItem is one element in the GET /v1/me/devices response.
type deviceListItem struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	UserAgent  *string `json:"userAgent"`
	Status     string  `json:"status"`
	CreatedAt  string  `json:"createdAt"`
	LastSeenAt *string `json:"lastSeenAt"`
}

// GetMe handles GET /v1/me.
func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)
	deviceID := httpx.DeviceID(ctx)

	q := gen.New(h.db)

	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
			return
		}
		slog.WarnContext(ctx, "get user by id error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	d, err := q.GetDeviceByID(ctx, deviceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "")
			return
		}
		slog.WarnContext(ctx, "get device by id error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, meResponse{
		User: meUserResponse{
			ID:          u.ID,
			Email:       u.Email,
			DisplayName: u.DisplayName,
			IsAdmin:     u.IsAdmin != 0,
			IsRoot:      u.IsRoot != 0,
		},
		Device: meDeviceResponse{
			ID:    d.ID,
			Label: d.Label,
		},
		Family:               nil,
		NotificationSettings: nil,
	})
}

// GetMyDevices handles GET /v1/me/devices.
func (h *Handler) GetMyDevices(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)

	q := gen.New(h.db)
	devs, err := q.ListUserDevices(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "list user devices error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	items := make([]deviceListItem, 0, len(devs))
	for _, d := range devs {
		item := deviceListItem{
			ID:        d.ID,
			Label:     d.Label,
			Status:    d.Status,
			CreatedAt: d.CreatedAt,
		}
		if d.UserAgent.Valid {
			s := d.UserAgent.String
			item.UserAgent = &s
		}
		if d.LastSeenAt.Valid {
			s := d.LastSeenAt.String
			item.LastSeenAt = &s
		}
		items = append(items, item)
	}

	httpx.WriteJSON(w, http.StatusOK, items)
}

// RevokeMyDevice handles POST /v1/me/devices/{id}/revoke.
// Revokes the device and all its sessions. Must belong to the current user.
func (h *Handler) RevokeMyDevice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)
	targetID := chi.URLParam(r, "id")

	q := gen.New(h.db)

	d, err := q.GetDeviceByID(ctx, targetID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, http.StatusNotFound, "not-found", "")
			return
		}
		slog.WarnContext(ctx, "get device by id error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	if d.UserID != userID {
		httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "")
		return
	}

	now := time.Now().UTC()
	nowStr := now.Format(rfc3339Ms)

	// Revoke the device and all its sessions in a single query each.
	// Using gen.Queries directly (accepts DBTX, works with *sql.DB).
	if err := q.RevokeDevice(ctx, gen.RevokeDeviceParams{
		RevokedAt:    sql.NullString{String: nowStr, Valid: true},
		RevokeReason: sql.NullString{String: "user_signout", Valid: true},
		ID:           targetID,
	}); err != nil {
		slog.WarnContext(ctx, "revoke device error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	if err := q.RevokeAllDeviceSessions(ctx, gen.RevokeAllDeviceSessionsParams{
		RevokedAt: sql.NullString{String: nowStr, Valid: true},
		DeviceID:  targetID,
	}); err != nil {
		slog.WarnContext(ctx, "revoke device sessions error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Audit: device.revoke.user
	_ = insertAudit(ctx, h.db, userID, "", "device.revoke.user", "device", targetID, nowStr)

	w.WriteHeader(http.StatusNoContent)
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
