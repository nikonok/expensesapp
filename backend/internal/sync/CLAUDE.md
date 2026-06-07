# internal/sync

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Implements the family-scoped sync protocol: `POST /v1/sync/push`,
`GET /v1/sync/pull`, and the SSE event bus that broadcasts `record.changed` to
peer devices. Treats record payloads as opaque ciphertext + AAD metadata.

## Key files

- `handlers.go` — `Handler` struct, dependency wiring, `SetEventBus`.
- `push.go` — `PostPush` handler; decodes records, runs per-record `records.Upsert`, returns `accepted` + `conflicts`.
- `pull.go` — `GetPull` handler; cursor-paged read up to 500 records per page.
- `cursor.go` — `EncodeCursor`/`DecodeCursor`; opaque base64url-encoded 8-byte BE uint64 over `family_seq`.
- `events.go` — `EventBus`; publishes `record.changed` to the `family:<id>` SSE scope and fans out Web Push via `pushDeliverer`.

## Public surface

- `Handler`, `NewHandler` — wired in `internal/server.NewRouter`.
- `EventBus`, `NewEventBus`, `SetPushDeliverer` — wires SSE + Web Push fan-out to push deliverer.
- `EncodeCursor`, `DecodeCursor` — exported for tests and for the snapshot restore path (`snapshot.RestoreSnapshot` emits a `sync.barrier{cursor}` event).
- `pushDeliverer` interface — implemented by `push.DigestService`; do NOT export new interfaces here, declare them at the consumer site.

## Conventions

- Cursor is a uint64 sequence per family (`family_seq`); empty string ⇒ seq=0 (full resync from beginning).
- `parentVersion` mismatch handling:
  - On a NEW record, `parentVersion != 0` ⇒ reject with `ErrInvalidParentVersion`.
  - On an EXISTING record, a mismatch ⇒ return a conflict entry with `currentBlob` (ciphertext) + `currentVersion` + `currentUpdatedAtMap` so the client can resolve.
- `blobOverheadBytes` = 73 (1 version + 24 nonce + 32 commit + 16 AEAD tag). Used in quota math.
- Per-push body limit: 8 MiB (`MaxBytesReader`). Per-pull limit: 500 records.
- SSE event names (must stay stable; client switches on these):
  - `record.changed` — `{seq, recordId, recordType, version}`, scope `family:<id>`.
  - `sync.barrier` — `{cursor}`, scope `family:<id>` (emitted by snapshot restore, NOT by push).
  - `family.changed`, `you.removed`, `device.joined` — emitted by other packages; sync only owns `record.changed`/`sync.barrier`.
- Web Push fan-out runs in a fire-and-forget goroutine with a 30 s timeout. Never block the HTTP response on push.

## Gotchas

- `EventBus.PublishRecordChanged` reads a `types` slice in parallel with `results`; index must match. Push handler builds them together — do not reorder.
- A push with zero records short-circuits with an empty accepted/conflicts response. Don't change this — clients depend on the idempotent no-op.
- `records.Upsert` mutates `family_seq`; the sync handler must publish events ONLY AFTER the outer transaction commits, otherwise SSE consumers race the DB.

## Tests

- Integration: `sync_integration_test.go` — covers cursor pagination, conflict path, push→SSE round trip.
- Add cursor and quota tests next to `cursor.go` / `push.go`. AAD/round-trip tests belong in `internal/crypto` and `internal/records`.
