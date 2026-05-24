package jobs

import (
	"context"
	"database/sql"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/account"
)

// NewDeletionPurgeJob returns a ScheduledJob that runs daily at 04:00 UTC and
// hard-deletes any users whose 14-day deletion grace period has elapsed.
func NewDeletionPurgeJob(db *sql.DB) ScheduledJob {
	return ScheduledJob{
		Name:     "deletion-purge",
		Schedule: DailyUTC{Hour: 4, Minute: 0},
		Run:      deletionPurgeRun(db),
	}
}

func deletionPurgeRun(db *sql.DB) Job {
	return func(ctx context.Context) {
		account.PurgePendingDeletions(ctx, db, time.Now().UTC())
	}
}
