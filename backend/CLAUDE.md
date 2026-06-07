# backend

> Link to repo root: [../CLAUDE.md](../CLAUDE.md)

## Purpose

Go 1.26 HTTP API that brokers E2E-encrypted family sync, auth, push, snapshots,
and admin operations. Backend never sees plaintext financial data — it persists
opaque ciphertext + AAD metadata only.

## Key files

- `cmd/api/main.go` — process entrypoint; loads config, opens DB, wires handlers, runs job runner.
- `internal/server/router.go` — chi router; canonical route table mirrors `docs/backend/architecture.md` §6.2.
- `internal/config/` — env-tag config (`caarlos0/env`); all knobs come from env vars.
- `sqlc.yaml` — sqlc codegen config; queries in `internal/db/queries.sql` → `internal/db/gen/`.
- `Dockerfile` — multi-stage build; final stage embeds migrations and runs as non-root.

## Public surface

- `cmd/api` is the only main package; library code lives under `internal/` and is not importable from outside the module.
- Inside the module, `internal/server.NewRouter` is the wiring seam used by both production and integration tests.
- All cross-package types flow through interfaces declared at the consuming site (e.g. `auth.Verifier`, `sync.pushDeliverer`).

## Conventions

- Router is shared between prod and tests — never duplicate routes in a test harness.
- Every protected route is registered inside the chain: `CSRFHeaderGate` → `SessionMiddleware` → optionally `RequireFamilyMembership` → optionally `RequireAdmin`. Public writes (`/v1/auth/google`) still go through `CSRFHeaderGate` + `PerIP` ratelimit.
- All DB writes go through `internal/db.WithTx`; no hand-rolled `BEGIN/COMMIT`.
- All queries are sqlc-generated. Do NOT hand-write SQL outside `internal/db/queries.sql` and `internal/db/migrations/*.sql`.
- SQLite with `SetMaxOpenConns(1)` — single writer; `_txlock=immediate` keeps WAL writers from starving.
- Times on the wire and in DB use `httpx.FormatTime` (RFC3339 with ms). Parse with `httpx.ParseTime`.
- IDs are UUID v7 (`google/uuid`), generated server-side except for client-owned IDs (familyId, recordId, deviceId).
- Errors to clients are RFC 9457 problem+json via `httpx.WriteError`; never leak internal errors.

## Gotchas

- `internal/db.Open` already configures journal_mode=wal, foreign_keys=on, busy_timeout=5000, mmap, and `_txlock=immediate`. Do not override these flags from callers.
- Adding a new route means adding it inside the right middleware group in `router.go`. A route placed at the top level skips auth/CSRF and will leak.
- `chimiddleware.RealIP` must run before any `ratelimit.PerIP`. The order is set in `router.go`; do not rearrange.
- `slog` is the only logger; use `slog.InfoContext(ctx, ...)` to keep request IDs in logs.

## Tests

- Unit tests live next to the code under test (`*_test.go`).
- Integration tests live in `internal/<pkg>/<pkg>_integration_test.go` and spin up a real router + SQLite via `internal/testenv`.
- Run from the backend dir: `go vet ./...`, `go build ./...`, `go test ./...`.
