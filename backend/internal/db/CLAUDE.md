# internal/db

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Owns SQLite database lifecycle: opens the file with the right PRAGMAs, applies
goose migrations on startup, and exposes the `WithTx` transaction helper used by
every mutation in the codebase.

## Key files

- `open.go` — `Open(ctx, path)`; opens SQLite with WAL, foreign_keys, busy_timeout, mmap, `_txlock=immediate`; runs goose migrations.
- `tx.go` — `WithTx(ctx, db, fn)`; begin/commit/rollback wrapper with panic-safe rollback.
- `queries.sql` — sqlc input; ALL SQL the app runs at runtime lives here.
- `schema.sql` — sqlc schema reference; mirrors the cumulative migration state.
- `migrations/00001_init.sql`, `00002_migrations.sql`, `00003_support_logs.sql` — goose Up/Down migrations.
- `gen/` — sqlc-generated code (queries, models, db handles). Do NOT edit by hand.

## Public surface

- `Open(ctx, path) (*sql.DB, error)` — used once at startup in `cmd/api/main.go`.
- `WithTx(ctx, db, func(*sql.Tx) error) error` — used by every service for write transactions.
- `gen.New(dbOrTx)` / `gen.Queries` — sqlc handle; every package uses this for SQL access.
- `gen.*Params` structs — input shapes for individual queries; regenerate after editing `queries.sql`.

## Conventions

- DB connection: `SetMaxOpenConns(1)` and `SetMaxIdleConns(1)`. SQLite is single-writer; this serializes writes and keeps WAL readers consistent.
- DSN flags are fixed in `Open` — `journal_mode=wal`, `synchronous=normal`, `busy_timeout=5000`, `foreign_keys=on`, `temp_store=memory`, `mmap_size=268435456`, `cache_size=-20000`, `_txlock=immediate`. Don't override.
- All migrations are managed by `goose`. New schema changes go into a new file `migrations/NNNNN_<name>.sql` with `-- +goose Up` / `-- +goose Down` blocks.
- All queries are written in `queries.sql` and regenerated via `sqlc generate` (config in `backend/sqlc.yaml`). Hand-written SQL anywhere else is a smell.
- Every mutation must go through `WithTx`. Single-statement writes (e.g. revoke session) MAY use the sqlc handle directly only when atomicity is not crossing tables.
- Time values are stored as RFC3339 with millisecond precision (`httpx.FormatTime`).
- Nullable columns are represented as `sql.NullString`/`sql.NullInt64` etc. in generated structs; package code wraps via `nullString` helpers in `family/handlers.go` (consider promoting if reused).

## Gotchas

- `_txlock=immediate` issues `BEGIN IMMEDIATE` on every non-read-only tx. Do NOT wrap reads in `WithTx` just for symmetry — it acquires the writer lock and blocks others.
- `db.SetMaxOpenConns(1)` means concurrent test goroutines serialize on the DB. If a test deadlocks, suspect a leaked tx.
- Migrations run synchronously inside `Open`. A bad migration crashes startup — fix the migration, never bypass it in code.
- The frontend has its own Dexie DB ("v1, all dev migrations collapsed"). That schema versioning is independent from the backend's goose versioning.
- Editing `gen/*` by hand will be silently overwritten next `sqlc generate`. Edit `queries.sql` instead.

## Tests

- No tests in this package itself; query correctness is exercised by the integration tests of consuming packages (`auth/integration_test.go`, `family/family_integration_test.go`, `sync/sync_integration_test.go`, etc.).
- New queries: add coverage in the package whose feature owns them.
