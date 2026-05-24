package jobs

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/push"
)

// NewDigestPushJob returns a ScheduledJob that runs hourly and sends the daily
// reminder digest to users whose local reminder_time matches the current
// hour:minute and are not in quiet hours.
func NewDigestPushJob(db *sql.DB, digestSvc *push.DigestService, qhSvc *push.QuietHoursService) ScheduledJob {
	return ScheduledJob{
		Name:     "digest-push",
		Schedule: HourlyTick{},
		Run:      digestPushRun(db, digestSvc, qhSvc),
	}
}

func digestPushRun(db *sql.DB, digestSvc *push.DigestService, qhSvc *push.QuietHoursService) Job {
	return func(ctx context.Context) {
		now := time.Now().UTC()
		slog.InfoContext(ctx, "digest-push: tick", "utc", now.Format(time.RFC3339))

		rows, err := db.QueryContext(ctx, `
			SELECT user_id, tz, reminder_time, family_digest
			FROM notification_settings
			WHERE (daily_reminder = 1 OR family_digest = 1)
			  AND reminder_time IS NOT NULL
		`)
		if err != nil {
			slog.WarnContext(ctx, "digest-push: query settings failed", "err", err)
			return
		}
		defer rows.Close()

		type row struct {
			UserID       string
			Tz           string
			ReminderTime sql.NullString
			FamilyDigest int64
		}

		var toNotify []row
		for rows.Next() {
			var sr row
			if scanErr := rows.Scan(&sr.UserID, &sr.Tz, &sr.ReminderTime, &sr.FamilyDigest); scanErr != nil {
				slog.WarnContext(ctx, "digest-push: scan row failed", "err", scanErr)
				continue
			}
			if !sr.ReminderTime.Valid || sr.ReminderTime.String == "" {
				continue
			}
			loc, locErr := time.LoadLocation(sr.Tz)
			if locErr != nil {
				loc = time.UTC
			}
			localNow := now.In(loc)
			h, m, parseErr := push.ParseHHMMExported(sr.ReminderTime.String)
			if parseErr != nil {
				continue
			}
			if localNow.Hour() == h && localNow.Minute() == m {
				toNotify = append(toNotify, sr)
			}
		}
		if closeErr := rows.Close(); closeErr != nil {
			slog.WarnContext(ctx, "digest-push: rows close failed", "err", closeErr)
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			slog.WarnContext(ctx, "digest-push: rows error", "err", rowsErr)
		}

		for _, sr := range toNotify {
			if ctx.Err() != nil {
				return
			}
			if qhSvc.ShouldHold(ctx, sr.UserID, now) {
				continue
			}
			if sr.FamilyDigest != 0 {
				digestSvc.SendDigestForUser(ctx, sr.UserID)
			}
		}

		slog.InfoContext(ctx, "digest-push: done", "candidates", len(toNotify))
	}
}
