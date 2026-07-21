package jobs

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/records"
	"github.com/nikonok/expensesapp/backend/internal/snapshot"
)

// NewDailySnapshotJob returns a ScheduledJob that runs daily at 03:00 UTC and:
//  1. Creates a snapshot for every family.
//  2. Prunes expired snapshots.
//  3. Prunes orphan blobs.
//  4. Reconciles families.usage_bytes from the live sum of blob sizes.
func NewDailySnapshotJob(db *sql.DB) ScheduledJob {
	svc := snapshot.NewService(db)
	return ScheduledJob{
		Name:     "daily-snapshot",
		Schedule: DailyUTC{Hour: 3, Minute: 0},
		Run:      dailySnapshotRun(db, svc),
	}
}

func dailySnapshotRun(db *sql.DB, svc *snapshot.Service) Job {
	return func(ctx context.Context) {
		date := time.Now().UTC().Format("2006-01-02")
		slog.InfoContext(ctx, "daily-snapshot: starting", "date", date)

		q := gen.New(db)
		families, err := q.ListFamilies(ctx)
		if err != nil {
			slog.ErrorContext(ctx, "daily-snapshot: list families failed", "err", err)
			return
		}

		succeeded := 0
		skipped := 0
		failed := 0

		for _, familyID := range families {
			if ctx.Err() != nil {
				slog.InfoContext(ctx, "daily-snapshot: context cancelled, stopping early")
				break
			}
			_, snapErr := svc.CreateSnapshot(ctx, familyID, date)
			switch {
			case snapErr == nil:
				succeeded++
			case errors.Is(snapErr, snapshot.ErrSnapshotAlreadyExists):
				skipped++
			default:
				failed++
				slog.WarnContext(ctx, "daily-snapshot: create snapshot failed",
					"family_id", familyID, "err", snapErr)
			}
		}

		slog.InfoContext(ctx, "daily-snapshot: snapshots done",
			"succeeded", succeeded, "skipped", skipped, "failed", failed)

		// Prune expired snapshots and orphan blobs.
		if pruneErr := svc.PruneExpiredSnapshots(ctx); pruneErr != nil {
			slog.WarnContext(ctx, "daily-snapshot: prune expired snapshots failed", "err", pruneErr)
		}
		if blobErr := svc.PruneOrphanBlobs(ctx); blobErr != nil {
			slog.WarnContext(ctx, "daily-snapshot: prune orphan blobs failed", "err", blobErr)
		}

		// Reconcile usage_bytes after pruning so the recompute reflects the
		// post-prune blob set.
		if reconcileErr := records.ReconcileUsage(ctx, db); reconcileErr != nil {
			slog.WarnContext(ctx, "daily-snapshot: reconcile usage bytes failed", "err", reconcileErr)
		}

		slog.InfoContext(ctx, "daily-snapshot: done", "date", date)
	}
}
