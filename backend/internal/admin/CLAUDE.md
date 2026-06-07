# internal/admin

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Admin-only HTTP endpoints: user list/suspend/unsuspend, allowlist CRUD,
admin promote/demote, audit log, device revocation, and the bootstrap-admin
handshake that runs on startup.

## Key files

- `bootstrap.go` — `EnsureBootstrap`; idempotent at startup; reconciles `BOOTSTRAP_ADMIN_EMAIL` env var with `bootstrap_state` singleton; handoff is transactional.
- `tree.go` — admin tree invariants (promoter graph, root vs admin distinction).
- `handlers.go` — all `/v1/admin/*` HTTP handlers; chi-routed behind `auth.RequireAdmin`.

## Public surface

- `EnsureBootstrap(ctx, db, email) error` — called once at startup in `cmd/api/main.go`.
- `Handler`, `NewHandler(db, hub)` — wired in `internal/server.NewRouter`.

## Conventions

- All admin endpoints sit behind `SessionMiddleware` → `CSRFHeaderGate` → `RequireAdmin`. Never expose a handler outside that chain.
- "Admin" = `is_admin=1 OR is_root=1`, AND `suspended_at IS NULL`. Suspended admins are not admins (enforced in `RequireAdmin`).
- Every admin mutation writes an `audit_log` row with action like `"admin.user.suspend"`, actor = caller, target = affected user/device/allowlist entry.
- Pagination: `defaultPageSize=50`, `maxPageSize=200`. Clients pass `limit` + `cursor`; cursor is base64url-encoded.
- Promote/demote follow the rules in `tree.go`:
  - Only a root can promote another user to admin.
  - Demoting your promoter is allowed; demoting root is NOT.
- Allowlist add/remove also updates audit log; removing an email does NOT revoke their existing sessions.
- `EnsureBootstrap` handles three cases:
  1. First boot (no `bootstrap_state` row): persist the email, defer allowlist insertion to first sign-in (FK on `users(id)` prevents insertion before any user exists).
  2. Same email as stored: no-op, no audit entry.
  3. Different email: transactional handoff — flip allowlist + admin flags atomically.

## Gotchas

- Allowlist auto-add at first sign-in lives in `auth/handlers.go` (Google sign-in path), NOT here — because the user row doesn't exist when `EnsureBootstrap` runs.
- Device revocation (`/v1/admin/devices/{id}/revoke`) revokes ALL sessions bound to that device, but does NOT change the user's family membership.
- `PostAdminDeleteImmediate` is intentionally restricted to self-delete (the caller's own user ID). It exists so an admin can wipe their own account during testing; it MUST NOT be reused to delete arbitrary users.

## Tests

- `admin_integration_test.go` — happy paths for each endpoint.
- `bootstrap_test.go` — all three startup cases including handoff race.
- Add new tests next to the file under test.
