package live

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// heartbeatInterval is the duration between SSE keepalive comments.
const heartbeatInterval = 25 * time.Second

// Handler is the HTTP handler for GET /v1/sync/live.
// It requires SessionMiddleware and RequireFamilyMembership to have run first.
type Handler struct {
	hub *Hub
}

// NewHandler constructs a live SSE Handler.
func NewHandler(hub *Hub) *Handler {
	return &Handler{hub: hub}
}

// GetLive handles GET /v1/sync/live.
// Sets SSE headers and streams events to the client until it disconnects.
func (h *Handler) GetLive(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "streaming unsupported")
		return
	}

	ctx := r.Context()
	userID := httpx.UserID(ctx)
	familyID := httpx.FamilyID(ctx)
	deviceID := httpx.DeviceID(ctx)

	// Set SSE headers before writing anything.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Register on the three relevant scopes.
	familyScope := "family:" + familyID
	userScope := "user:" + userID
	deviceScope := "device:" + deviceID

	chFamily, unregFamily := h.hub.Register(familyScope)
	defer unregFamily()
	chUser, unregUser := h.hub.Register(userScope)
	defer unregUser()
	chDevice, unregDevice := h.hub.Register(deviceScope)
	defer unregDevice()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	slog.InfoContext(ctx, "live.SSE: client connected",
		"user_id", userID,
		"device_id", deviceID,
		"family_id", familyID,
	)

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "live.SSE: client disconnected",
				"user_id", userID,
				"device_id", deviceID,
			)
			return

		case <-h.hub.Done():
			// Server is shutting down — return promptly instead of making
			// graceful shutdown wait for the client to disconnect on its own.
			slog.InfoContext(ctx, "live.SSE: hub shutting down, closing connection",
				"user_id", userID,
				"device_id", deviceID,
			)
			return

		case ev := <-chFamily:
			writeEvent(w, flusher, ev)

		case ev := <-chUser:
			writeEvent(w, flusher, ev)

		case ev := <-chDevice:
			writeEvent(w, flusher, ev)

		case <-ticker.C:
			// Write an SSE comment as the keepalive.
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// writeEvent formats and flushes a single SSE event.
func writeEvent(w http.ResponseWriter, flusher http.Flusher, ev Event) {
	if ev.IsKeepalive() {
		fmt.Fprintf(w, ": keepalive\n\n")
	} else if ev.Type != "" {
		safeType := strings.ReplaceAll(ev.Type, "\n", "")
		safeType = strings.ReplaceAll(safeType, "\r", "")
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", safeType, ev.Data)
	} else {
		fmt.Fprintf(w, "data: %s\n\n", ev.Data)
	}
	flusher.Flush()
}
