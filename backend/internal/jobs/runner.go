// Package jobs provides a context-aware background job runner with graceful
// shutdown support.
package jobs

import (
	"context"
	"log/slog"
	"sync"
)

// Job is a function that runs as a scheduled background task.
// The context is cancelled when the runner is stopping.
type Job func(ctx context.Context)

// ScheduledJob pairs a Job with the schedule it should run on.
type ScheduledJob struct {
	Name string
	// Schedule specifies when the job should run (see CronSchedule).
	Schedule Schedule
	Run      Job
}

// JobRunner manages a set of scheduled background jobs. It starts each job in
// its own goroutine and stops them gracefully when Stop is called.
type JobRunner struct {
	jobs   []ScheduledJob
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewJobRunner constructs a JobRunner with the provided jobs.
func NewJobRunner(jobs ...ScheduledJob) *JobRunner {
	return &JobRunner{jobs: jobs}
}

// Start launches all registered jobs in background goroutines.
// It returns immediately — it does NOT block the caller.
// Call Stop to initiate graceful shutdown.
func (jr *JobRunner) Start(ctx context.Context) {
	runCtx, cancel := context.WithCancel(ctx)
	jr.cancel = cancel

	for _, j := range jr.jobs {
		j := j // capture loop var
		jr.wg.Add(1)
		go func() {
			defer jr.wg.Done()
			slog.Info("job runner: starting job", "job", j.Name)
			j.Schedule.Run(runCtx, j.Name, j.Run)
			slog.Info("job runner: job stopped", "job", j.Name)
		}()
	}
}

// Stop cancels the runner context and waits for all jobs to finish.
func (jr *JobRunner) Stop() {
	if jr.cancel != nil {
		jr.cancel()
	}
	jr.wg.Wait()
}
