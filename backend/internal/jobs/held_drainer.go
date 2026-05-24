package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/push"
)

// NewHeldDrainerJob returns a ScheduledJob that runs every minute and delivers
// held_notifications whose deliver_after has passed.
func NewHeldDrainerJob(db *sql.DB, deliverer *push.Deliverer) ScheduledJob {
	return ScheduledJob{
		Name:     "held-drainer",
		Schedule: HourlyTick{}, // fires at each UTC minute boundary
		Run:      heldDrainerRun(db, deliverer),
	}
}

func heldDrainerRun(db *sql.DB, deliverer *push.Deliverer) Job {
	return func(ctx context.Context) {
		now := time.Now().UTC().Format(time.RFC3339)
		q := gen.New(db)

		due, err := q.ListDueHeldNotifications(ctx, now)
		if err != nil {
			slog.WarnContext(ctx, "held-drainer: list due notifications failed", "err", err)
			return
		}
		if len(due) == 0 {
			return
		}

		slog.InfoContext(ctx, "held-drainer: draining", "count", len(due))

		for _, n := range due {
			if ctx.Err() != nil {
				return
			}

			// Validate payload is parseable JSON before delivery.
			var raw json.RawMessage
			if jsonErr := json.Unmarshal(n.Payload, &raw); jsonErr != nil {
				slog.WarnContext(ctx, "held-drainer: invalid payload, dropping",
					"id", n.ID, "err", jsonErr)
				_ = q.DeleteHeldNotification(ctx, n.ID)
				continue
			}

			// Deliver; mandatory=true so if still in quiet hours it re-queues.
			deliverer.Deliver(ctx, n.UserID, n.Payload, true)

			// Delete the held row regardless of delivery outcome — the Deliverer
			// handles subscription-level retry/GC independently.
			if delErr := q.DeleteHeldNotification(ctx, n.ID); delErr != nil {
				slog.WarnContext(ctx, "held-drainer: delete held notification failed",
					"id", n.ID, "err", delErr)
			}
		}
	}
}
