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

// HourlyTick is a Schedule that fires once at the top of each UTC minute
// (i.e. at :00 seconds) to enable per-minute reminder matching.
type HourlyTick struct{}

// Run blocks until ctx is cancelled, calling fn once at the start of each UTC minute.
func (h HourlyTick) Run(ctx context.Context, name string, fn Job) {
	for {
		now := time.Now().UTC()
		// Next :00 seconds boundary.
		next := now.Truncate(time.Minute).Add(time.Minute)
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
