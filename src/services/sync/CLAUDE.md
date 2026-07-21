# src/services/sync

[root CLAUDE.md](../../../CLAUDE.md)

## Purpose

Outbox-based encrypt/push/pull engine and Server-Sent-Events live wiring. Drives end-to-end-encrypted family sync against the Go backend.

## Key files

- `engine.ts` — `enqueuePush`, `flushOutbox`, `pullSince`, `startLiveSync`, `approveDevice`/`rejectDevice`.
- `push-helpers.ts` — per-record-type wrappers (`pushTransaction`, `pushAccount`, `pushCategory`, `pushBudget`, `pushSetting`) called from every write path; resolve wire identity via `record-mapping.ts`.
- `record-mapping.ts` — the canonical local↔server record-identity table (Dexie `recordMappings`, v8), shared with `services/family/migrate.ts`. See "Record identity" below.
- `client.ts` — typed HTTP wrappers for `POST /api/v1/sync/push` and `GET /api/v1/sync/pull` (via `apiFetch`).
- `cursor.ts` — per-family cursor persistence in Dexie `syncCursors`, plus `encodeCursor(seq)` / `decodeCursor(cursor)`.
- `merge.ts` — LWW conflict resolution. The only shape any current write path produces is whole-record `{ _all: <ts> }`; a legacy per-field code path is kept for defensiveness only.
- `sse.ts` — EventSource wrapper with reconnect/backoff and typed `SSEPayloadMap`.
- `background-sync.ts` — Workbox periodic-sync + catch-up registration helpers.
- `types.ts` — `RawRecord`, `PullResponse`, `ConflictRecord`, `SyncCursor`. `PendingUpload` is NOT declared here — it lives in `@/db/models` (it's a Dexie table row) and is re-exported from this module for convenience.

## Public surface

- `enqueuePush(record: RawRecord)` — encrypt → store in `db.pendingUploads` → fire `flushOutbox()` when online. Callers are expected to have already resolved `record.recordId` to a real UUID (via `push-helpers.ts`), not a raw Dexie id. Coalesces: a non-terminal outbox row for the same `(recordType, recordId)` is overwritten in place rather than adding a second row.
- `flushOutbox()` — serialised flush (only one runs at a time; a call that arrives mid-flush sets a `pendingFlushRequested` flag and re-runs once the in-flight run finishes); loops over 50-record batches while more than `PUSH_BATCH_SIZE` non-terminal rows remain; schedules an exponential-backoff retry (capped ~5 min) after a transient network/5xx failure.
- `retryTerminalUploads()` — clears the `terminal` flag on every terminal outbox row (413 quota, deterministic 400) and re-flushes. Wired to the Retry button on the quota banner in `SyncSettings.tsx`.
- `pullSince(familyId, cursor)` — decrypt + write to local tables + advance cursor; loops internally until the server reports `hasMore: false`.
- `startLiveSync(familyId)` — connects SSE (re-pulling from the stored cursor on every open/reconnect), wires a `window` "online" listener (flush + pull), returns a disconnect function that tears both down.
- `pushTransaction` / `pushTransactionTombstone` / `pushAccount` / `pushCategory` / `pushBudget` / `pushSetting` (`push-helpers.ts`) — the actual call sites: `balance.service.ts` (apply/update/delete), account/category/budget forms + trash restore, `settings-store.ts`.

## Record identity (the `recordMappings` table)

Every synced record needs a UUID `recordId` on the wire — the server 400s anything else (`uuid.Parse`), and Dexie's per-device auto-increment ids collide across devices. `record-mapping.ts` owns the ONE canonical `(recordType, localId) → { uuid, lastServerVersion, creatorUserId }` mapping (Dexie `recordMappings`, schema v8; primary key is the `uuid` itself, with a unique compound index on `[recordType+localId]`). `localId` is `String(dexie id)` for transaction/account/category/budget, or the raw settings key string for `recordType: "settings"`.

- **Push direction** (`getOrCreateMappingForPush`): `push-helpers.ts` resolves/mints the mapping for a local row before building the `RawRecord` — `recordId = mapping.uuid`, `parentVersion = mapping.lastServerVersion`, `addedByUserId = mapping.creatorUserId` (the ORIGINAL creator, never overwritten by a later editor), `editedByUserId = current user`. On accept, `flushOutbox` looks the mapping up by the accepted `recordId` and calls `updateLastServerVersion` so the next edit carries the right `parentVersion`.
- **Pull direction** (`getMappingByUuid` / `upsertMappingFromPull`): `writeDecryptedRecord` NEVER trusts `payload.id` — that's whichever device originally created the row, meaningless (or actively dangerous — it can collide with an unrelated local row) on this device. It resolves the server `uuid` → local id via the mapping; for a genuinely new record it lets Dexie mint a fresh id via `add()` and persists the mapping (creator = the server's `addedByUser`); for an already-mapped record it overwrites the existing row in place (`put()` with `id` forced to the mapped localId).
- `services/family/migrate.ts` uses the exact same table (`getOrCreateMappingForPush`) for solo→family migration — there is only one mapping table in the whole app.

## Conventions

- AAD inputs (`familyId`, `recordId`, `recordType`, `addedByUserId`, `editedByUserId`, `updatedAtMap`, `deletedAt`, `plaintextByteCount`, `nonce`) must be filled per `RawRecord`; if you add a new field to the meta, update both `src/services/crypto/aad.ts` AND `backend/internal/crypto/aad.go` together — see crypto package notes.
- Cursor encoding: opaque base64url of an 8-byte big-endian `uint64` (`familySeq`), **no padding**. Both `cursor.ts:encodeCursor`/`decodeCursor` and the backend's `EncodeCursor`/`DecodeCursor` must stay byte-identical.
- `flushOutbox` advances the cursor to the max accepted `familySeq` ONLY when that run is contiguous with the current cursor position (no gap) — a gap means another device's records sit in between that haven't been pulled yet, and fast-forwarding past them would skip them forever.
- Conflict path: server returns the current encrypted blob + map (+ `currentAddedByUser`/`currentEditedByUser`/`currentDeletedAt`/`reason`). `reason: "quota"` is NOT a data conflict — the row is left queued as-is for later retry, never merged or deleted. `currentDeletedAt` non-empty means the server side is a tombstone — apply it locally by identity (no decrypt) and drop the local edit, unless the local op was itself a delete. Otherwise: decrypt both sides using the conflict response's OWN editor ids (never the local outbox row's), run `mergePayloads`, re-encrypt with `parentVersion = conflict.currentVersion`, re-enqueue. The original outbox row is deleted ONLY after its replacement/resolution has been enqueued — a failed resolve leaves the edit queued for retry rather than losing it.
- Use `apiFetch` (no direct `fetch`) — it sets the `X-Requested-With: fetch` CSRF header.
- A 413 push response marks the whole batch `terminal` (quota banner); a 400 also marks the batch `terminal` (the push endpoint validates all-or-nothing, and a 400 is deterministic — retrying an identical payload would fail forever). Network/5xx errors are transient — bump `attempts`/`lastFailedAt`, leave non-terminal, and let the backoff retry pick them up. `flushOutbox`'s outbox query excludes terminal rows via `.filter()` (evaluated during the Dexie cursor walk, before `.limit()`) so they can never starve the batch window.

## Balance-aware pull writes (Account.balance is STORED, not derived)

`writeDecryptedRecord` keeps the affected account's stored balance correct for every pulled transaction, using the exact same delta math as `balance.service.ts` (via its exported `getBalanceDelta` — never duplicate this logic):

- Pulled transaction CREATE (no local row mapped to the uuid yet): insert, then apply its delta.
- Pulled transaction UPDATE (a local row is already mapped): revert the OLD local row's delta, apply the NEW payload's delta, then write the row — all in one `db.transaction('rw', ...)`.
- Pulled transaction TOMBSTONE: revert the local row's delta, then hard-delete it (the soft-delete rule applies only to accounts/categories, not transactions).
- If the transaction's account isn't known locally yet, the transaction row is still inserted/updated/deleted and a warning is logged — the balance simply isn't adjustable yet. This does NOT double-count: a pulled ACCOUNT record that's brand-new locally is created with the payload's `balance` verbatim (an authoritative snapshot from the sender that already reflects every transaction applied to it at push time), so an account create-snapshot arriving before or after a transaction for it in the same pull page always converges to the right total.
- A pulled ACCOUNT record for an account that's ALREADY known locally keeps this device's own `balance` — every other field is overwritten from the payload. **Accepted limitation**: a manual "Adjust balance" edit on one device only propagates to another device via that OTHER device's own account-create snapshot (i.e. never, once both devices already have the account) — this is intentional. Applying an incoming `balance` field to an already-known account would clobber the exact per-device delta bookkeeping above the moment any other device made a concurrent transaction edit; a rare manual operation losing propagation is a far smaller cost than silently corrupting balances on every concurrent transaction edit.

## Gotchas

- `flushOutbox` is gated by `flushInProgress`; do not race-call it — a call that arrives while one is in flight is coalesced via `pendingFlushRequested`, not dropped.
- `pullSince` skips records whose decrypted payload fails the Zod schema, or fails to decrypt — investigate with logs, do not silently re-encrypt. It never advances the cursor past a failed record; the failure (and everything after it in that page) is retried on the next call.
- Pulled `settings` records are validated (`{key: string, value: unknown}`) and dropped unless `key` is in `push-helpers.ts`'s `SYNCED_SETTING_KEYS` allow-list; an applied (non-dropped) write also refreshes the in-memory `useSettingsStore` cache via `setState` so a remote change is visible without reload.
- `startLiveSync` debounces `record.changed` pulls to one per 500 ms, and re-pulls from the stored cursor on every SSE `onOpen` (initial connect or reconnect) — SSE never replays missed events on its own.
- `sse.ts`'s 60s heartbeat watchdog force-closes and reconnects the `EventSource` (not just a log) — the server keepalives every 25s, so 60s of silence means the connection is dead. Its per-event-type `lastSeenSeq` dedup map is capped (FIFO eviction) to avoid unbounded growth on a long-lived connection.
- `you.removed` and a `device.revoked` event targeting THIS device (compared via `useAuthStore.getState().device?.id`) both wipe ALL local Dexie state via the shared `wipeLocalStateAndSignOut` helper; never extend that path without zero-data guarantees.
- `sync.barrier` (from a snapshot restore) and `SnapshotRestore.tsx` both clear `db.pendingUploads` before pulling (stale `parentVersion`s would just churn/conflict against server state the barrier just replaced) and deliberately do NOT pre-adopt the server's returned cursor before the rebuild pull — `pullSince`'s own per-record bookkeeping is what advances the cursor; pre-setting it and having the pull fail before applying anything would orphan the rebuild (the cursor would sit at the final position with zero records actually applied).
- The `parentVersion` field is critical: 0 for new records, last-seen server version for updates (from `recordMappings.lastServerVersion`); conflicts return the canonical value.
- The canonical persisted `familyId` location is the first row of Dexie `syncCursors` (see `services/family/active-family.ts`); `setLocalFamilyId` seeds it at family creation, device activation, and recovery-envelope unwrap — before any real pull has run.

## Tests

- `__tests__/engine.test.ts`, `__tests__/merge.test.ts`, `__tests__/cursor.test.ts`, `__tests__/sse.test.ts`, `__tests__/push-helpers.test.ts`, `__tests__/record-mapping.test.ts`.
- Add new tests next to existing ones; mock `cryptoWorker` rather than the real Web Worker. Mock the HTTP client (`client.ts`), not Dexie — `record-mapping.ts`/`cursor.ts` are exercised against the real `fake-indexeddb`-backed `db`.
