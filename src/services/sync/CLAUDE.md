# src/services/sync

[root CLAUDE.md](../../../CLAUDE.md)

## Purpose

Outbox-based encrypt/push/pull engine and Server-Sent-Events live wiring. Drives end-to-end-encrypted family sync against the Go backend.

## Key files

- `engine.ts` — `enqueuePush`, `flushOutbox`, `pullSince`, `startLiveSync`, `silentlyApproveDevice`.
- `client.ts` — typed HTTP wrappers for `POST /api/v1/sync/push` and `GET /api/v1/sync/pull` (via `apiFetch`).
- `cursor.ts` — per-family cursor persistence in Dexie `syncCursors`, plus `encodeCursor(seq)`.
- `merge.ts` — LWW conflict resolution by `updatedAtMap` per-field.
- `sse.ts` — EventSource wrapper with reconnect/backoff and typed `SSEPayloadMap`.
- `background-sync.ts` — Workbox periodic-sync + catch-up registration helpers.
- `types.ts` — `RawRecord`, `PullResponse`, `ConflictRecord`, `SyncCursor`.

## Public surface

- `enqueuePush(record: RawRecord)` — encrypt → store in `db.pendingUploads` → fire `flushOutbox()` when online.
- `flushOutbox()` — serialised flush (only one runs at a time); pushes up to 50 records, resolves conflicts.
- `pullSince(familyId, cursor)` — decrypt + write to local tables + advance cursor.
- `startLiveSync(familyId)` — connects SSE, returns a disconnect function.

## Conventions

- **`enqueuePush` MUST be called from every write path** that mutates a synced record (transaction, account, category, budget, settings). As of writing it is invoked from: _(none — see WORK_PLAN.md brief B1)_. Future call-sites: `balance.service.ts` (apply/update/delete), account create/edit/trash, category create/edit/trash, budget upsert, settings writes.
- AAD inputs (`familyId`, `recordId`, `recordType`, `addedByUserId`, `editedByUserId`, `updatedAtMap`, `deletedAt`, `plaintextByteCount`, `nonce`) must be filled per `RawRecord`; if you add a new field to the meta, update both `src/services/crypto/aad.ts` AND `backend/internal/crypto/aad.go` together — see crypto package notes.
- Cursor encoding: opaque base64url of an 8-byte big-endian `uint64` (`familySeq`), **no padding**. Both `cursor.ts:encodeCursor` and the backend's `EncodeCursor` must stay byte-identical.
- `flushOutbox` advances the cursor to the max accepted `familySeq` so the next pull does not re-fetch records this client just pushed.
- Conflict path: server returns the current encrypted blob + map; we decrypt both sides, run `mergePayloads`, re-encrypt with `parentVersion = conflict.currentVersion`, re-enqueue.
- Use `apiFetch` (no direct `fetch`) — it sets the `X-Requested-With: fetch` CSRF header.

## Gotchas

- `flushOutbox` is gated by `flushInProgress`; do not race-call it.
- `pullSince` skips records whose decrypted payload fails the Zod schema — investigate with logs, do not silently re-encrypt.
- `startLiveSync` debounces `record.changed` pulls to one per 500 ms.
- `you.removed` SSE event wipes ALL local Dexie state; never extend that branch without zero-data guarantees.
- The `parentVersion` field is critical: 0 for new records, last-seen server version for updates; conflicts return the canonical value.

## Tests

- `__tests__/engine.test.ts`, `__tests__/merge.test.ts`, `__tests__/cursor.test.ts`, `__tests__/sse.test.ts`.
- Add new tests next to existing ones; mock `cryptoWorker` rather than the real Web Worker.
