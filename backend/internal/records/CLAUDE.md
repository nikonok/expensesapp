# internal/records

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Core record storage + sync semantics. Owns the per-record upsert path used by
`sync.push`, the per-field LWW (last-write-wins) merge of `updatedAtMap`, and
per-family storage quota.

## Key files

- `service.go` — `Service.Upsert`; one record per call, runs inside a caller-supplied transaction; returns either a success result, a conflict result, or `ErrInvalidParentVersion`.
- `lww.go` — `MergeUpdatedAtMap(current, incoming)`; per-field comparison; unparseable timestamps default to "incoming wins".
- `quota.go` — `CheckQuota(currentBytes, incomingBytes)`; hard cap `QuotaMaxBytes = 200 MiB` per family; sentinel `ErrQuotaExceeded`.

## Public surface

- `Service`, `NewService(db)` — used by `sync.handlers` and `family.MigrateSolo`.
- `UpsertParams`, `UpsertResult`, `ConflictResult` — record I/O shapes.
- `ValidRecordTypes` — closed set: `transaction|account|category|budget|settings`.
- `MergeUpdatedAtMap` — exported for tests and for migration-solo merging.
- `CheckQuota`, `QuotaMaxBytes`, `ErrQuotaExceeded`, `ErrInvalidParentVersion`.

## Conventions

- `recordType` MUST be a member of `ValidRecordTypes`. Unknown types are rejected.
- `parentVersion` semantics:
  - New record (no prior `record_meta` row): `parentVersion` MUST be 0; non-zero ⇒ `ErrInvalidParentVersion`.
  - Existing record: `parentVersion` MUST equal current `version`; mismatch ⇒ returns a `ConflictResult` (NOT an error) with `currentBlob` so the client can re-encrypt and retry.
- LWW merge: per-field comparison of RFC3339-ms timestamps. Incoming field wins iff strictly newer. Unparseable timestamps default to "incoming wins" to avoid silent drops.
- Quota check runs BEFORE `Upsert` — caller is responsible. `Upsert` does not re-check.
- Every upsert increments `family_seq` (monotonic per family) and `version` (monotonic per record).
- `timeNow` and `nowUTC` are package vars for test override.

## Gotchas

- `Service.Upsert` REQUIRES a transaction in the params. It does not start one — the caller (sync.push handler) opens a single tx for the whole batch so partial pushes are atomic.
- `families.usage_bytes` is maintained incrementally on each upsert. Drift is possible; a nightly reconcile job is on the roadmap (see `quota.go` TODO).
- `settings` records are stored per-family AND per-user via the same record table — distinguish via the record key, not by record_type alone.
- Conflict response `currentBlob` is the FULL ciphertext + AAD, so the client can decrypt locally and resolve. Do not strip it.

## Tests

- Service unit tests should pair an in-memory SQLite with a real schema; use the testenv helpers.
- LWW + quota math are pure functions — easy unit-test targets; add cases for empty maps and boundary byte counts.
- End-to-end conflict path is covered in `internal/sync/sync_integration_test.go`.
