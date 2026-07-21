package push

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

// Handler holds dependencies for push + notification HTTP endpoints.
type Handler struct {
	db     *sql.DB
	subSvc *SubscriptionService
	qhSvc  *QuietHoursService
	hub    *live.Hub // optional; nil disables notification.dismiss SSE
}

// NewHandler constructs a push Handler.
func NewHandler(db *sql.DB, hub *live.Hub) *Handler {
	return &Handler{
		db:     db,
		subSvc: NewSubscriptionService(db),
		qhSvc:  NewQuietHoursService(db),
		hub:    hub,
	}
}

// --------------------------------------------------------------------------
// POST /v1/push/subscribe
// --------------------------------------------------------------------------

type subscribeRequest struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"` // base64url
	Auth     string `json:"auth"`   // base64url
}

// PostSubscribe stores a new push subscription bound to the caller's device.
func (h *Handler) PostSubscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	deviceID := httpx.DeviceID(ctx)
	if deviceID == "" {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthenticated", "missing device context")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	var req subscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.Endpoint == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "endpoint is required")
		return
	}

	p256dh, err := decodeBase64URL(req.P256dh)
	if err != nil || len(p256dh) == 0 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "p256dh must be non-empty base64url")
		return
	}
	auth, err := decodeBase64URL(req.Auth)
	if err != nil || len(auth) == 0 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "auth must be non-empty base64url")
		return
	}

	id, err := h.subSvc.Store(ctx, deviceID, req.Endpoint, p256dh, auth)
	if err != nil {
		slog.WarnContext(ctx, "push.Handler: store subscription failed", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// --------------------------------------------------------------------------
// DELETE /v1/push/subscribe/{id}
// --------------------------------------------------------------------------

// DeleteSubscribe hard-deletes a push subscription after verifying ownership.
// Returns 404 for missing or foreign subscriptions (no existence leak).
func (h *Handler) DeleteSubscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	deviceID := httpx.DeviceID(ctx)
	id := chi.URLParam(r, "id")
	if id == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "id is required")
		return
	}

	// Ownership check: the subscription must belong to the caller's device.
	subs, err := gen.New(h.db).ListPushSubscriptionsForDevice(ctx, deviceID)
	if err != nil {
		slog.WarnContext(ctx, "push.Handler: list device subs for ownership check failed", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}
	found := false
	for _, sub := range subs {
		if sub.ID == id {
			found = true
			break
		}
	}
	if !found {
		// 404 — don't reveal whether the id exists at all.
		httpx.WriteError(w, r, http.StatusNotFound, "not-found", "subscription not found")
		return
	}

	if err := h.subSvc.Delete(ctx, id); err != nil {
		slog.WarnContext(ctx, "push.Handler: delete subscription failed", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// GET /v1/notifications/settings
// --------------------------------------------------------------------------

type notificationSettingsResponse struct {
	Tz            string `json:"tz"`
	ReminderTime  string `json:"reminderTime"` // "HH:MM" or "" if disabled
	QuietStart    string `json:"quietStart"`
	QuietEnd      string `json:"quietEnd"`
	DailyReminder bool   `json:"dailyReminder"`
	MissedDay     bool   `json:"missedDay"`
	FamilyDigest  bool   `json:"familyDigest"`
	UpdatedAt     string `json:"updatedAt"`
}

// GetNotificationSettings returns the user's notification settings, creating a
// default row if none exists.
func (h *Handler) GetNotificationSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)

	q := gen.New(h.db)
	ns, err := q.GetNotificationSettings(ctx, userID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.WarnContext(ctx, "push.Handler: get notification settings failed", "err", err)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
			return
		}
		// Auto-create defaults.
		now := httpx.FormatTime(time.Now().UTC())
		upsertErr := q.UpsertNotificationSettings(ctx, gen.UpsertNotificationSettingsParams{
			UserID:        userID,
			Tz:            "UTC",
			ReminderTime:  sql.NullString{},
			QuietStart:    "23:00",
			QuietEnd:      "07:00",
			DailyReminder: 1,
			MissedDay:     1,
			FamilyDigest:  0,
			UpdatedAt:     now,
		})
		if upsertErr != nil {
			slog.WarnContext(ctx, "push.Handler: create default notification settings failed", "err", upsertErr)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
			return
		}
		ns = gen.NotificationSetting{
			UserID:        userID,
			Tz:            "UTC",
			QuietStart:    "23:00",
			QuietEnd:      "07:00",
			DailyReminder: 1,
			MissedDay:     1,
			FamilyDigest:  0,
			UpdatedAt:     now,
		}
	}

	resp := notificationSettingsResponse{
		Tz:            ns.Tz,
		ReminderTime:  ns.ReminderTime.String,
		QuietStart:    ns.QuietStart,
		QuietEnd:      ns.QuietEnd,
		DailyReminder: ns.DailyReminder != 0,
		MissedDay:     ns.MissedDay != 0,
		FamilyDigest:  ns.FamilyDigest != 0,
		UpdatedAt:     ns.UpdatedAt,
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// --------------------------------------------------------------------------
// PATCH /v1/notifications/settings
// --------------------------------------------------------------------------

type patchNotificationSettingsRequest struct {
	Tz            *string `json:"tz"`
	ReminderTime  *string `json:"reminderTime"` // "HH:MM" or "" to disable
	QuietStart    *string `json:"quietStart"`
	QuietEnd      *string `json:"quietEnd"`
	DailyReminder *bool   `json:"dailyReminder"`
	MissedDay     *bool   `json:"missedDay"`
	FamilyDigest  *bool   `json:"familyDigest"`
}

// PatchNotificationSettings updates the user's notification settings.
func (h *Handler) PatchNotificationSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)

	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	var req patchNotificationSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}

	q := gen.New(h.db)

	// Load existing or defaults.
	ns, err := q.GetNotificationSettings(ctx, userID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.WarnContext(ctx, "push.Handler: get notification settings failed", "err", err)
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
			return
		}
		ns = gen.NotificationSetting{
			UserID:        userID,
			Tz:            "UTC",
			QuietStart:    "23:00",
			QuietEnd:      "07:00",
			DailyReminder: 1,
			MissedDay:     1,
			FamilyDigest:  0,
		}
	}

	// Apply patch fields.
	if req.Tz != nil {
		// Validate timezone.
		if _, tzErr := time.LoadLocation(*req.Tz); tzErr != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "tz is not a valid timezone")
			return
		}
		ns.Tz = *req.Tz
	}
	if req.ReminderTime != nil {
		if *req.ReminderTime == "" {
			ns.ReminderTime = sql.NullString{}
		} else {
			if _, _, parseErr := parseHHMM(*req.ReminderTime); parseErr != nil {
				httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "reminderTime must be HH:MM or empty")
				return
			}
			ns.ReminderTime = sql.NullString{String: *req.ReminderTime, Valid: true}
		}
	}
	if req.QuietStart != nil {
		if _, _, parseErr := parseHHMM(*req.QuietStart); parseErr != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "quietStart must be HH:MM")
			return
		}
		ns.QuietStart = *req.QuietStart
	}
	if req.QuietEnd != nil {
		if _, _, parseErr := parseHHMM(*req.QuietEnd); parseErr != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "quietEnd must be HH:MM")
			return
		}
		ns.QuietEnd = *req.QuietEnd
	}
	if req.DailyReminder != nil {
		if *req.DailyReminder {
			ns.DailyReminder = 1
		} else {
			ns.DailyReminder = 0
		}
	}
	if req.MissedDay != nil {
		if *req.MissedDay {
			ns.MissedDay = 1
		} else {
			ns.MissedDay = 0
		}
	}
	if req.FamilyDigest != nil {
		if *req.FamilyDigest {
			ns.FamilyDigest = 1
		} else {
			ns.FamilyDigest = 0
		}
	}

	now := httpx.FormatTime(time.Now().UTC())
	ns.UpdatedAt = now

	if upsertErr := q.UpsertNotificationSettings(ctx, gen.UpsertNotificationSettingsParams{
		UserID:        userID,
		Tz:            ns.Tz,
		ReminderTime:  ns.ReminderTime,
		QuietStart:    ns.QuietStart,
		QuietEnd:      ns.QuietEnd,
		DailyReminder: ns.DailyReminder,
		MissedDay:     ns.MissedDay,
		FamilyDigest:  ns.FamilyDigest,
		UpdatedAt:     now,
	}); upsertErr != nil {
		slog.WarnContext(ctx, "push.Handler: upsert notification settings failed", "err", upsertErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	resp := notificationSettingsResponse{
		Tz:            ns.Tz,
		ReminderTime:  ns.ReminderTime.String,
		QuietStart:    ns.QuietStart,
		QuietEnd:      ns.QuietEnd,
		DailyReminder: ns.DailyReminder != 0,
		MissedDay:     ns.MissedDay != 0,
		FamilyDigest:  ns.FamilyDigest != 0,
		UpdatedAt:     now,
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// --------------------------------------------------------------------------
// POST /v1/notifications/dismiss
// --------------------------------------------------------------------------

type dismissRequest struct {
	NotificationID string `json:"notificationId"`
}

// PostDismiss broadcasts a "notification.dismiss" SSE event to the user's other
// devices so they can clear the local notification.
func (h *Handler) PostDismiss(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := httpx.UserID(ctx)

	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	var req dismissRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}
	if req.NotificationID == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "notificationId is required")
		return
	}

	if h.hub != nil {
		payload, _ := json.Marshal(map[string]string{"notificationId": req.NotificationID})
		h.hub.Publish("user:"+userID, live.Event{
			Type: "notification.dismiss",
			Data: payload,
		})
	}

	w.WriteHeader(http.StatusNoContent)
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// decodeBase64URL decodes a base64url string (raw or padded).
func decodeBase64URL(s string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}
