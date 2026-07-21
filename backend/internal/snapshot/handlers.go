package snapshot

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

// Handler holds dependencies for snapshot HTTP endpoints.
type Handler struct {
	db  *sql.DB
	svc *Service
	hub *live.Hub
}

// NewHandler constructs a snapshot Handler.
func NewHandler(db *sql.DB, hub *live.Hub) *Handler {
	return &Handler{
		db:  db,
		svc: NewService(db),
		hub: hub,
	}
}

// --------------------------------------------------------------------------
// Response types
// --------------------------------------------------------------------------

type snapshotItem struct {
	SnapshotID string `json:"snapshotId"`
	Date       string `json:"date"`
	CreatedAt  string `json:"createdAt"`
	ExpiresAt  string `json:"expiresAt"`
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------

// GetSnapshots handles GET /v1/snapshots.
// Returns the last 30 snapshots for the caller's family.
func (h *Handler) GetSnapshots(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	familyID := httpx.FamilyID(ctx)
	if familyID == "" {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "caller has no active family")
		return
	}

	q := gen.New(h.db)
	snapshots, err := q.ListSnapshotsForFamily(ctx, familyID)
	if err != nil {
		slog.WarnContext(ctx, "snapshot.list: query failed", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	items := make([]snapshotItem, 0, len(snapshots))
	for _, s := range snapshots {
		items = append(items, snapshotItem{
			SnapshotID: s.ID,
			Date:       s.SnapshotDate,
			CreatedAt:  s.CreatedAt,
			ExpiresAt:  s.ExpiresAt,
		})
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"snapshots": items})
}

// PostRestore handles POST /v1/snapshots/{date}/restore?confirm=true.
// Requires ?confirm=true query param to prevent accidental restores.
func (h *Handler) PostRestore(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	familyID := httpx.FamilyID(ctx)
	userID := httpx.UserID(ctx)
	date := chi.URLParam(r, "date")

	if familyID == "" {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "caller has no active family")
		return
	}
	if r.URL.Query().Get("confirm") != "true" {
		httpx.WriteError(w, r, http.StatusBadRequest, "confirm-required", "add ?confirm=true to confirm the restore")
		return
	}
	if date == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "date path parameter is required")
		return
	}

	// Resolve snapshot by date.
	q := gen.New(h.db)
	snap, err := q.GetSnapshotByDate(ctx, gen.GetSnapshotByDateParams{
		FamilyID:     familyID,
		SnapshotDate: date,
	})
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusNotFound, "not-found", "no snapshot found for that date")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "snapshot.restore: lookup snapshot", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	result, svcErr := h.svc.RestoreSnapshot(ctx, familyID, snap.ID, userID, h.hub)
	if svcErr != nil {
		slog.WarnContext(ctx, "snapshot.restore: service error", "err", svcErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"newCursor": result.NewCursor,
	})
}
