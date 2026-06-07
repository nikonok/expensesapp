# internal/auth

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Owns Google sign-in, opaque session cookies, CSRF gating, family/admin middleware,
and the reauth challenge/grant flow used by sensitive endpoints
(e.g. recovery-phrase reveal).

## Key files

- `google.go` — `Verifier` interface + `idtoken`-backed implementation; verifies Google ID tokens.
- `allowlist.go` — checks whether an email may sign up; bootstrap email is allowlisted on first sign-in.
- `handlers.go` — `POST /v1/auth/google` (sign-in/up + device upsert), `/v1/auth/signout`, `/v1/auth/signout-all`.
- `session.go` — `Mint`, `Validate`, `TouchAndMaybeRotate`, `Revoke*`; cookie format `<sessionID>.<base64urlToken>`; sha256(token) is what we store.
- `middleware.go` — `SessionMiddleware`, `CSRFHeaderGate`, `RequireAdmin`, `RequireFamilyMembership`.
- `reauth.go` — `POST /v1/reauth/challenge` (60 s nonce) + `POST /v1/reauth/verify` (mints single-use `reauth_grant`, 60 s TTL).

## Public surface

- `Handler`, `ReauthHandler` — wired in `internal/server.NewRouter`.
- `SessionMiddleware`, `CSRFHeaderGate`, `RequireAdmin`, `RequireFamilyMembership` — chain-building middleware.
- `Verifier` interface — replace in tests via a fake; production uses `NewGoogleVerifier`.
- `Mint`, `Revoke`, `RevokeAll`, `RevokeAllForDevice` — used by handlers; do NOT call from other packages.

## Conventions

- Cookie name is `__Host-session`; HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=2592000 (30 days).
- Server stores only `sha256(token)`. The raw token is returned once at mint and lives only in the cookie.
- Session validation is cached for 60 s in `sessionCache` (sync.Map keyed by hash). Revocation does NOT evict — cache entries expire naturally; tests can flush via the test-only helper.
- Token rotation cadence: every 24 h (`rotateThreshold`). `TouchAndMaybeRotate` runs synchronously BEFORE `next.ServeHTTP` so the new `Set-Cookie` header still fits.
- Reauth grants are single-use, 60 s TTL, bound to the issuing session, with `purpose = "reveal_recovery_phrase"`.
- Google ID token verification goes through `google.golang.org/api/idtoken` (audience check, signature, exp). Tests swap in a fake `Verifier`.
- All mutations to sessions/reauth/users go through `internal/db.WithTx`.

## Gotchas

- `CSRFHeaderGate` only enforces the `X-Requested-With: fetch` header on POST/PUT/PATCH/DELETE. Frontend must send it on every mutating call.
- `RequireFamilyMembership` reads `family_members.left_at IS NULL`; users mid-leave will 403 with `family-required`.
- `Suspended` users pass `Validate` once before being rejected. Always re-check via `gen.GetUserByID` in admin paths.
- `RevokeAllForDevice` is what runs on family kick — not `RevokeAll(userID)` — because a user may still be in other families.

## Tests

- Unit: `session_test.go`, `middleware_test.go`, `session_cache_test.go`, `google_test.go`, `allowlist_test.go`.
- Integration: `integration_test.go`, `reauth_integration_test.go` — full router + sqlite via `internal/testenv`.
- Helpers for crafting valid cookies live in `session_testhelpers.go`.
