# src/services/family

[root CLAUDE.md](../../../CLAUDE.md)

## Purpose

Family lifecycle on the client: create/init, invite/accept/decline, list members, leave, remove member, and solo-to-family migration on accept.

## Key files

- `client.ts` — typed HTTP wrappers: `createInvite`, `listIncomingInvites`, `acceptInvite`, `declineInvite`, `listFamilyMembers`, `leaveFamily`, `removeMember`, `migrateSolo`, plus `NeedsMigrationDecisionError`.
- `init.ts` — initial family creation: generates `familyKey`, recovery envelopes, and POSTs the commit.
- `migrate.ts` — gathers local Dexie records, re-encrypts them under the target family key in a single batch call (via `cryptoWorker.migrateSoloRecords`), and POSTs `migrateSolo`.
- `active-family.ts` — reads / persists the active `familyId` (Dexie settings key).
- `client.test.ts`, `init.test.ts` — unit tests.

## Public surface

- All exports from `client.ts` (HTTP wrappers + `NeedsMigrationDecisionError`).
- `initFamily(...)` from `init.ts`.
- `migrateSoloRecordsToFamily(targetFamilyId, targetFamilyKey)` from `migrate.ts`.
- `getActiveFamilyId()` / setter from `active-family.ts`.

## Conventions

- **Invite/join/leave flow**:
  1. Inviter calls `createInvite(email)` → backend stores pending invite.
  2. Invitee calls `listIncomingInvites()` then `acceptInvite(inviteId)`. `acceptInvite` best-effort reads this device's pubkey via `cryptoWorker.getDevicePublicKey()` and sends it (base64url) as `devicePubKey` in the body — the backend uses it to update the device's on-file pubkey and drive the `device.joined` approval flow. Optional server-side; a missing/failed pubkey read still accepts the invite.
  3. If the invitee has solo data, the backend responds 409 with problem type `needs-migration-decision`; `acceptInvite` throws `NeedsMigrationDecisionError` carrying `targetFamilyId`. The UI then prompts the user; on "merge" the client unwraps the target family key (provided by the backend on a subsequent retry) and calls `migrateSoloRecordsToFamily`.
  4. `leaveFamily(takeCopy)` soft-leaves; `removeMember(userId)` is admin/owner-only.
- **`migrationId` is required and is the idempotency key** for `POST /api/v1/family/migrate-solo`. The backend rejects (`400 bad-request`) when missing and returns the cached migration result on retries with the same id. `migrate.ts`'s `getOrCreateMigrationId(sourceFamilyId, targetFamilyId)` mints (or reuses, on retry) this id and persists it in `db.settings` keyed by the `(source, target)` pair before calling `migrateSolo` — WORK_PLAN.md brief B2 is done.
- Use `apiFetch` only (CSRF header + cookie handling). Never call `fetch` directly here.
- Re-encryption in `migrate.ts` must use `cryptoWorker.migrateSoloRecords(targetEnvelope, persistAfter, records)` (the envelope-based batch variant) — it unwraps the target key in-worker and encrypts every record without the raw key ever crossing `postMessage`.

## Gotchas

- Solo-to-family migration writes a `updatedAtMap` of `{ _all: now }` and uses `record.id` as `recordId`; downstream merge logic relies on this.
- `listFamilyMembers()` swallows 404 → empty array (solo users). Do not change that to surface the 404.
- `init.ts` is the only place that should generate a new `familyKey`. All other paths receive an existing key via SSE envelope or recovery unwrap.

## Tests

- Add tests next to `client.test.ts` / `init.test.ts`; mock `apiFetch` via the shared test setup.
