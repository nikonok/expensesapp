package snapshot

import (
	"context"
	"log/slog"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// PruneExpiredSnapshots deletes snapshots whose expires_at is before now.
// Cascading FK on snapshot_entries handles entry cleanup.
func (s *Service) PruneExpiredSnapshots(ctx context.Context) error {
	now := httpx.FormatTime(timeNow())
	q := gen.New(s.db)
	if err := q.DeleteExpiredSnapshots(ctx, now); err != nil {
		slog.WarnContext(ctx, "snapshot.prune: delete expired snapshots failed", "err", err)
		return err
	}
	slog.InfoContext(ctx, "snapshot.prune: expired snapshots removed")
	return nil
}

// PruneOrphanBlobs deletes blobs not referenced by record_meta OR snapshot_entries.
func (s *Service) PruneOrphanBlobs(ctx context.Context) error {
	q := gen.New(s.db)
	if err := q.DeleteOrphanBlobs(ctx); err != nil {
		slog.WarnContext(ctx, "snapshot.prune: delete orphan blobs failed", "err", err)
		return err
	}
	slog.InfoContext(ctx, "snapshot.prune: orphan blobs removed")
	return nil
}
