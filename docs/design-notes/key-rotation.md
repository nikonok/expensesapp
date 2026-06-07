# Design note — Family key rotation on member removal (B5b)

Status: PROPOSED. No code yet — orchestrator decides whether to ship as-is, simplify, or defer.

## Why

A removed family member retains a copy of the `familyKey` until it is rotated.
Without rotation, "remove member" is a server-side ACL change only; the
ex-member's device can still decrypt every record it has ever pulled and every
new record it can pull before the SSE `you.removed` event takes effect on its
side. For an app that markets itself as E2E-encrypted, that is a meaningful
trust-model gap.

The fix is to generate a fresh `familyKey'`, re-wrap it for each remaining
active device, and rotate the AAD to bind subsequent ciphertexts to a new key
epoch. Old records stay under the old key for as long as we keep that key
around for read-back.

## Proposed crypto worker RPC

```ts
rotateFamilyKey(familyId: string): Promise<{
  newWrapped: Map<deviceId, envelopeB64u>;
  kEpoch: number;
}>
```

Behavior, all inside the worker:

1. Read the currently stored `familyKey` (errors out with `NoStoredFamilyKey`
   otherwise — only an active family admin can rotate).
2. Generate `familyKey' = randombytes_buf(32)`.
3. For each active device pubkey provided by the caller (admin device fetches
   the list from `GET /v1/family/devices` before invoking the RPC), call
   `wrapKeyForDevice(familyKey', pubKey)` and collect the envelopes into a
   `Map<deviceId, envelopeB64u>`.
4. Increment the stored `kEpoch` counter (key in `expenses-app-keys` →
   `familyKeyEpoch`, default 0). The new epoch number rides on the response.
5. Persist `familyKey'` under a side key (`familyKey.next`) — NOT overwriting
   the current `familyKey` until the server confirms the rotation
   transaction. After confirmation the worker promotes `familyKey.next` →
   `familyKey` and the old key becomes `familyKey.prev` (kept for the grace
   period so still-in-flight pulls can decrypt records ciphered under the old
   epoch).

## New backend endpoint

`POST /v1/family/key-rotation`

Request:

```json
{
  "kEpoch": 7,
  "wrapped": [{ "deviceId": "dev-...", "envelope": "<base64url-80-bytes>" }],
  "removedUserId": "user-..."
}
```

Behavior in one DB transaction:

1. Verify the actor is an admin (or owner) of the family.
2. Mark the target member as `left_at = now()` (existing soft-leave path).
3. Insert the wrapped envelopes into the existing
   `family_device_envelopes` table with `k_epoch = kEpoch`.
4. Write a `family_key_epochs` row: `(familyId, epoch, createdAt, expiresAt)`
   where `expiresAt = now() + 1 hour` (grace period for in-flight pulls).
5. Broadcast `family.key-rotated` SSE to every active device in the family
   (excluding the removed user's devices), carrying `{ kEpoch, envelope }`
   where `envelope` is each device's individual wrapped copy.

Errors: 403 if not admin; 409 if a rotation is already in flight for this
family; 422 if the wrapped map omits any currently active deviceId.

## RemoveMember integration

`family/service.go:RemoveMember` becomes:

1. Validate admin/owner permission (existing).
2. Mark the member as left (existing).
3. Call the key-rotation handler **internally as the same admin actor** —
   this requires the admin's device to provide the wrapped map. So
   `RemoveMember` cannot stay pure server-side. We add a two-step protocol:
   - Step A: admin device calls `POST /v1/family/members/{id}/remove-init`,
     which returns the list of active devices + their pubkeys (excluding
     the leaving member's devices) plus a one-time `rotationToken`.
   - Step B: admin device builds the wrapped map locally via
     `rotateFamilyKey`, then calls `POST /v1/family/members/{id}/remove-commit`
     with `{ rotationToken, wrapped, kEpoch }`. The handler verifies the
     token, runs the single DB transaction described above, and emits SSE.

If the admin device crashes between init and commit, the rotation token
expires after 60 s and the leaving member is unaffected (still a member).
The admin retries.

## AAD changes

Append a `keyEpoch` byte (uint16, big-endian) to `serializeAAD` in BOTH
`src/services/crypto/aad.ts` and `backend/internal/crypto/aad.go`. Position:
after `deletedAt`, before `plaintextByteCount` (preserving the existing field
ordering for everything except the new field). The vectors in
`backend/internal/crypto/testdata/aad-vectors.json` must be regenerated; an
existing record without an explicit epoch is treated as `epoch=0`.

The decrypt path becomes "epoch-aware":

```
plaintext = decryptRecord(blob, familyKey[epoch], meta)
```

Where the worker keeps a small ladder: `familyKey[current]`,
`familyKey[current-1]` (the prior epoch, retained for the grace window). On
failure with the current epoch the worker retries ONCE with `current-1` —
exactly one step back, no further. Anything older was rotated out beyond the
grace period and should not be readable any more.

## Migration concerns

- Records written before this proposal carry no `keyEpoch` byte. The Go AAD
  serializer treats the absence as `epoch=0`; the TS side does the same. Both
  sides MUST be updated together (the golden vector file is the contract).
- Existing snapshots / backups (see `backup.service.ts`) include the
  ciphertexts but not the key. After rotation, a restore from snapshot taken
  before the rotation needs the old `familyKey.prev` — implies snapshots
  must carry an opaque epoch tag so the worker can decrypt against the right
  key. This is non-trivial: either we widen the snapshot format (preferred)
  or we forbid restores across a rotation boundary (simpler, worse UX).
- Pending outbox rows still encrypted under the old epoch must be re-encrypted
  on rotation. Path: after `rotateFamilyKey` succeeds, the worker walks
  `pendingUploads`, decrypts each blob with the prior key + epoch, re-encrypts
  with the new key + new epoch, and re-stores them. This is bounded
  (`PUSH_BATCH_SIZE = 50` × however many batches), but should happen inside
  one outer transaction with the epoch promotion so we never end up with a
  mixed-epoch outbox.

## Background "expire old epoch" job

After 1 hour the backend's background job:

- Marks `family_key_epochs.expiresAt` as elapsed.
- Removes the row (we no longer need it; nothing should be decrypting that
  epoch any more).
- Notifies devices via SSE `family.key-epoch-expired` so they can drop the
  worker-side `familyKey.prev` and reclaim the storage slot.

Clients that have been offline for >1 hour and hold records still cipher'd
under the prior epoch will see decrypt failures during their next pull. This
is acceptable: the SSE `sync.barrier` flow + a fresh full pull recovers them
(every record they care about has been re-issued under the new epoch by other
active devices, or — for records the leaving member created — never modified
since the rotation, so they remain decryptable as long as `prev` is held).

## Open questions / risks for orchestrator review

1. **Session token rotation alongside key rotation?** If a removed member's
   access token is still valid for 15 minutes, do they get one last
   `pull-since` they can decrypt with the old key? Recommendation: invalidate
   sessions for the removed user in the SAME DB transaction as the rotation,
   not later. Worth confirming the existing `session.service.go` supports
   this kind of force-revoke cleanly.
2. **AAD vector breakage.** Adding `keyEpoch` to the serializer is a
   coordinated change between TS and Go. Vectors regenerate cleanly, but
   anything that pinned the old vector in a CI snapshot must be updated.
3. **Snapshot interaction.** Per "Migration concerns" above — extending the
   snapshot format is preferred but requires its own design pass.
4. **Multiple rotations in quick succession.** Two admins remove different
   members within the same minute. Current proposal serialises via the
   server (409 if a rotation is in flight); is that strict enough or do we
   need a per-family rotation queue?
5. **Member rejoin.** If the same user is later re-invited, do they get
   a fresh device + epoch path, or do we keep `familyKey.prev` so they can
   decrypt records they wrote pre-removal? Recommendation: treat re-invite
   as a brand-new join — they get the current epoch, no historical access.
6. **Recovery code regeneration on rotation.** Envelope A (kRecovery wrap)
   is tied to `familyId`, not key epoch — but a rotation that doesn't also
   re-wrap kRecovery means a holder of the BIP39 phrase can recover the old
   key. Decision needed: do we rotate the recovery envelope alongside, or
   accept that cold-recovery returns a stale key the user then has to step
   forward from? The simpler path is to require regeneration of the
   recovery code on rotation; the workflow already exists in Settings →
   Security.
7. **Worst case: only one device.** If the admin is the sole device left
   in the family, key rotation is unnecessary (no one to lock out). The
   handler should short-circuit and skip the rotation when the device count
   is 1 (the removed user obviously). Saves a round-trip; worth confirming
   with the UX team that "no fingerprint changes if you're alone" is OK.
8. **Concurrent write race.** Devices that push during the rotation window
   may see their parentVersion become stale (the server has accepted a
   re-encrypted version of the same record under the new epoch). The
   merge layer handles this — but the conflict path needs to know which
   epoch to decrypt the server-returned blob with. Per "AAD changes",
   the response carries the epoch byte.
9. **Audit log surface.** Should rotation produce a user-visible audit
   entry (Settings → Security → Recent activity)? Recommend yes — the user
   should be able to see "Removed Alice • 2026-06-07 14:32 • familyKey
   rotated".
