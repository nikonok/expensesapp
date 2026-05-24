package account

// logs.go — POST /v1/logs/send handler (Phase 11).
// Accepts a JSON payload from the client and stores it in support_logs.

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// maxLogBodyBytes caps the request body at 1 MiB to prevent abuse.
const maxLogBodyBytes = 1 * 1024 * 1024

// sendLogsRequest is the JSON body for POST /v1/logs/send.
type sendLogsRequest struct {
	Logs        json.RawMessage `json:"logs"`
	UserConsent bool            `json:"userConsent"`
}

// PostSendLogs handles POST /v1/logs/send.
// Body: {logs: [...], userConsent: true} → 204 No Content.
func (h *Handler) PostSendLogs(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLogBodyBytes)

	var req sendLogsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}

	if !req.UserConsent {
		httpx.WriteError(w, r, http.StatusBadRequest, "consent-required", "userConsent must be true")
		return
	}

	ctx := r.Context()
	userID := httpx.UserID(ctx)

	// Re-serialise as a canonical JSON blob for storage.
	payload, err := json.Marshal(req.Logs)
	if err != nil {
		slog.WarnContext(ctx, "logs: marshal payload error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	id, err := uuid.NewV7()
	if err != nil {
		slog.WarnContext(ctx, "logs: uuid error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	now := time.Now().UTC()
	nowStr := httpx.FormatTime(now)

	q := gen.New(h.db)
	if err := q.InsertSupportLog(ctx, gen.InsertSupportLogParams{
		ID:        id.String(),
		UserID:    userID,
		Payload:   payload,
		CreatedAt: nowStr,
	}); err != nil {
		slog.WarnContext(ctx, "logs: insert support log error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
