# internal/family

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Owns family lifecycle (Init, invite, accept/decline, leave, remove member,
migrate-solo) and the device/recovery envelope endpoints used to share the
family key across devices.

## Key files

- `service.go` — `Service` orchestrating Init, SendInvite, AcceptInvite, DeclineInvite, Leave, RemoveMember; all mutations wrapped in `internaldb.WithTx`.
- `migrate.go` — placeholder; `MigrateSolo` itself lives in `service.go`.
- `devices.go` — `POST /v1/family/devices/{id}/envelope` (activate pending device with a 80-byte wrappedKey).
- `recovery_envelope.go` — `GET /v1/family/recovery-envelope`.
- `handlers.go` — HTTP layer; decodes/validates JSON, calls into `Service`, maps service errors to RFC 9457 status codes, publishes SSE events.
- `invariants.go` — guards (e.g. max members per family, tie-break rules).

## Public surface

- `NewHandler(db)` — constructs the HTTP handler; wired in `internal/server.NewRouter`.
- `Service` and its `*Params` structs — internal to the package; the handler is the only caller.
- Sentinel errors (`ErrAlreadyInFamily`, `ErrInviteNotFound`, `ErrInviteNotPending`, `ErrInviteExpired`, `ErrInviteEmailMismatch`, `ErrNeedsMigrationDecision`, `ErrFamilyFull`, `ErrDuplicateInvite`, `ErrNotAllowlisted`, `ErrNotSameFamily`, `ErrCoolDown`, `ErrTieBreakDenied`, `ErrNotInTargetFamily`) — map to specific 4xx responses in the handler switch.

## Conventions

- `familyId`, `recordId`, `deviceId` are client-generated UUID v7 strings; server validates with `uuid.Parse`.
- All envelope byte lengths are strict: `deviceEnvelope` = exactly 80 bytes; `recovery.wrap`, `recovery.phraseCt` ≥ 49 bytes; `recovery.salt` = exactly 16 bytes.
- `MigrateSolo` is idempotent on `migrationId`; the caller MUST supply a stable UUID per logical migration. Re-running with the same id is a no-op.
- `updatedAtMap` on migrate-solo records is JSON-encoded as a string (NOT a nested object) — keep this contract for client compatibility.
- Family isolation is enforced by `auth.RequireFamilyMembership`, which injects `familyID` into ctx via `httpx.WithFamilyID`. Handlers MUST read it via `httpx.FamilyID(ctx)`.
- SSE events: `family.changed{kind: member_joined|member_left|member_removed, userId}` published to scope `family:<id>`; `you.removed{familyId, reason: left|kicked}` published to `user:<id>`.
- Audit entries are best-effort (errors logged, not returned). Use `insertAudit` in `handlers.go`.

## Gotchas

- `Leave` publishes both `member_left` (to remaining members) AND `you.removed{reason: left}` (to the leaver) — needed so the leaver's other devices clear their local state.
- `RemoveMember` enforces a cool-down AND a tie-break (later joiner cannot remove an earlier joiner). Both checks return distinct error codes.
- A "duplicate" invite is one where a pending invite for the same email already exists in the same family. Cross-family duplicate invites are allowed.
- `decodeBase64URL` accepts both raw (no padding) and padded base64url. Don't tighten this without checking the frontend encoder.

## Tests

- Integration: `family_integration_test.go`, `family_lifecycle_test.go` — full router via `internal/testenv`.
- Add new lifecycle tests in `family_lifecycle_test.go`; isolated handler tests next to the file they cover.
