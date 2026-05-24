package jobs

import (
	"context"
	"log/slog"
	"time"
)

// Schedule determines when a job runs. Implementations block until the context
// is cancelled, calling fn at each scheduled time.
type Schedule interface {
	Run(ctx context.Context, name string, fn Job)
}

// DailyUTC is a Schedule that fires once per day at the given UTC hour and
// minute.
type DailyUTC struct {
	Hour   int
	Minute int
}

// Run blocks until ctx is cancelled, calling fn once per day at the configured
// UTC time.
func (d DailyUTC) Run(ctx context.Context, name string, fn Job) {
	for {
		next := nextRun(time.Now().UTC(), d.Hour, d.Minute)
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			slog.Info("job: running", "job", name, "scheduled_at", next.Format(time.RFC3339))
			func() {
				defer func() {
					if p := recover(); p != nil {
						slog.Error("job: panic recovered", "job", name, "panic", p)
					}
				}()
				fn(ctx)
			}()
		}
	}
}

// nextRun returns the next UTC time at hour:minute on or after now.
func nextRun(now time.Time, hour, minute int) time.Time {
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, time.UTC)
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
