# internal/snapshot

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Daily family-scoped snapshots of `record_meta`, restore-from-snapshot, and
TTL-based pruning. Restore emits a `sync.barrier{cursor}` SSE event so peer
clients reset their local state.

## Key files

- `service.go` — `Service.CreateSnapshot`; idempotent per (family, date) UNIQUE constraint; returns `ErrSnapshotAlreadyExists` for duplicates.
- `restore.go` — `Service.RestoreSnapshot`; for each entry in the snapshot, upserts `record_meta` to that state; for each `record_meta` outside the snapshot, soft-deletes it (version++, new `family_seq`); emits `sync.barrier`.
- `prune.go` — `Service.PruneExpired`; removes snapshots past `snapshotTTL` (30 days) and orphan blobs.
- `handlers.go` — `GET /v1/snapshots` (list), `POST /v1/snapshots/{date}/restore` (restore by date).
- `snapshot_integration_test.go` — round-trip create → restore → SSE barrier.

## Public surface

- `Service`, `NewService` — used in handlers and in `jobs.NewDailySnapshotJob`.
- `Handler`, `NewHandler` — wired in `internal/server.NewRouter`.
- `RestoreResult{NewCursor}` — base64url cursor that clients adopt after restore.
- Sentinel errors: `ErrSnapshotAlreadyExists`, `ErrSnapshotNotFound`.

## Conventions

- `date` is `YYYY-MM-DD` in UTC. Restore endpoint takes `{date}`, not snapshot ID.
- `CreateSnapshot` is idempotent — duplicate (family, date) returns the existing ID + sentinel error. Callers (including the daily job) treat the sentinel as a skip, not a failure.
- Restore is a single transaction over `record_meta`: snapshot entries are applied via upsert; non-snapshot rows are soft-deleted with `deleted_at = now`, `version++`, new `family_seq`.
- After commit, restore emits `sync.barrier{cursor: NewCursor}` to scope `family:<id>` via the live hub.
- Audit log: `audit_log` row with action `"snapshot.restore"`, actor = caller user.
- TTL: 30 days (`snapshotTTL`). Prune runs daily after snapshot creation.

## Gotchas

- The "delete records not in snapshot" pass is O(rows × snapshot_size). Acceptable at current scale (≤50 users, ≤200 MiB per family) but worth measuring before larger deployments.
- `sync.barrier` MUST be emitted AFTER the tx commits — otherwise SSE consumers see the barrier before the new state is visible.
- `RestoreSnapshot` increments `family_seq` for every soft-delete; this CAN create large jumps in client cursors. Frontend must handle that.
- Snapshot blobs are NOT re-encrypted on restore — they reference the same `blobs.commit_id`. Pruning orphan blobs is what reclaims space.

## Tests

- Integration: `snapshot_integration_test.go` — restore happy path + barrier + orphan deletion.
- Add prune tests close to `prune.go`. Add an idempotency test for `CreateSnapshot` if not already present.
