# internal/jobs

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Context-aware background job runner with graceful shutdown. Owns the schedules
for daily snapshots, deletion purge, digest push, and held-notification draining.

## Key files

- `runner.go` — `JobRunner`; `Start(ctx)` launches each job in its own goroutine; `Stop()` cancels and waits.
- `schedule.go` — `Schedule` interface, `DailyUTC{Hour,Minute}` (fires once per UTC day), `HourlyTick` (fires at the top of each UTC minute, for per-minute reminders).
- `snapshot_daily.go` — daily 03:00 UTC: create per-family snapshots, prune expired snapshots, prune orphan blobs.
- `deletion_purge.go` — daily: hard-delete user accounts past the deletion grace period.
- `digest_push.go` — periodic digest delivery (record-change roll-up).
- `held_drainer.go` — drains `held_notifications` whose `deliver_after` has passed (quiet hours queue).

## Public surface

- `JobRunner`, `NewJobRunner(jobs ...ScheduledJob)`, `Start`, `Stop`.
- `Job` (function type), `ScheduledJob` struct, `Schedule` interface.
- `DailyUTC`, `HourlyTick` implementations.
- `NewDailySnapshotJob(db)`, `NewDeletionPurgeJob(...)`, `NewDigestPushJob(...)`, `NewHeldDrainerJob(...)` — constructors used in `cmd/api/main.go`.

## Conventions

- All jobs honor the runner's context; on cancel they MUST return promptly.
- Each tick is wrapped in a `recover()` block — a panic in one job does NOT take down the runner.
- Job names are stable strings used in slog (`job=daily-snapshot`); changing them breaks log filters.
- Daily jobs use UTC times; "midnight" means 00:00 UTC, not local.
- Avoid long-running work on `HourlyTick` — the tick fires every minute; missing one is acceptable but cumulative drift is not.

## Gotchas

- `JobRunner.Start` returns immediately; the caller must keep the process alive and wire `Stop()` into shutdown.
- Two job instances writing the same row will fight over the writer connection (SetMaxOpenConns=1). Schedules are spaced apart to avoid this.
- Daily snapshot job uses `snapshot.CreateSnapshot`, which is idempotent — re-running at 03:00 on the same UTC day is a no-op, not a failure.
- `held_drainer` queries `held_notifications` and re-attempts delivery; long quiet windows can produce backlogs that the drainer flushes at quiet-end.

## Tests

- Job-specific tests are sparse; current coverage is via integration tests in the consuming packages (`internal/snapshot/snapshot_integration_test.go`, etc.).
- Add unit tests for `nextRun` / `HourlyTick.Run` if you change scheduling logic — these are pure functions and easy to test.
