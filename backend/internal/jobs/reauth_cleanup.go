package jobs

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

// reauthRetention is how long past expiry a reauth_challenges/reauth_grants
// row is kept before being purged. Both tables have a 60s TTL, but expired or
// used rows are otherwise never removed.
const reauthRetention = 24 * time.Hour

// NewReauthCleanupJob returns a ScheduledJob that runs daily at 05:00 UTC and
// deletes reauth_challenges/reauth_grants rows whose expires_at is older than
// reauthRetention.
func NewReauthCleanupJob(db *sql.DB) ScheduledJob {
	return ScheduledJob{
		Name:     "reauth-cleanup",
		Schedule: DailyUTC{Hour: 5, Minute: 0},
		Run:      reauthCleanupRun(db),
	}
}

func reauthCleanupRun(db *sql.DB) Job {
	return func(ctx context.Context) {
		cutoff := httpx.FormatTime(time.Now().UTC().Add(-reauthRetention))
		q := gen.New(db)

		if err := q.DeleteOldReauthChallenges(ctx, cutoff); err != nil {
			slog.WarnContext(ctx, "reauth-cleanup: delete old challenges failed", "err", err)
		}
		if err := q.DeleteOldReauthGrants(ctx, cutoff); err != nil {
			slog.WarnContext(ctx, "reauth-cleanup: delete old grants failed", "err", err)
		}
		slog.InfoContext(ctx, "reauth-cleanup: done", "cutoff", cutoff)
	}
}
