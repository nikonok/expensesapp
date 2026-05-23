package sync

import (
	"database/sql"

	"github.com/nikonok/expensesapp/backend/internal/records"
)

// Handler holds dependencies for sync HTTP endpoints.
type Handler struct {
	db  *sql.DB
	svc *records.Service
}

// NewHandler constructs a sync Handler.
func NewHandler(db *sql.DB) *Handler {
	return &Handler{
		db:  db,
		svc: records.NewService(db),
	}
}
