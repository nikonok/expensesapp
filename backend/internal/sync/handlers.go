package sync

import (
	"database/sql"

	"github.com/nikonok/expensesapp/backend/internal/records"
)

// Handler holds dependencies for sync HTTP endpoints.
type Handler struct {
	db       *sql.DB
	svc      *records.Service
	eventBus *EventBus // optional; nil disables SSE publish
}

// NewHandler constructs a sync Handler.
func NewHandler(db *sql.DB) *Handler {
	return &Handler{
		db:  db,
		svc: records.NewService(db),
	}
}

// SetEventBus wires the SSE event bus into the handler. Must be called before
// the server starts serving requests.
func (h *Handler) SetEventBus(eb *EventBus) {
	h.eventBus = eb
}
