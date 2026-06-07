# src/services/auth

[root CLAUDE.md](../../../CLAUDE.md)

## Purpose

Authentication: Google ID-token sign-in, device-key generation on first sign-in, session state (Zustand), and the privileged-action reauth ceremony.

## Key files

- `client.ts` — `apiFetch<T>(path, init)` — the single HTTP entrypoint for the whole frontend. Sets `Accept: application/json`, `credentials: "include"`, and the CSRF header on write methods. Throws typed `ApiError` carrying `status` and the RFC-7807 `problem` body.
- `google.ts` — `signInWithGoogle({ clientId, nonce? })` — loads Google Identity Services and resolves with `{ idToken }`.
- `session.ts` — `useAuthStore` (Zustand): `signIn`, `signOut`, `refreshMe`, `pendingDevicePubKey`, `awaitingEnvelope`, `needsFamilyInit`.
- `reauth.ts` — `requestReauthGrant()` 3-step ceremony returning a 60 s `grantId`.
- `reauth.test.ts` — vitest.

## Public surface

- `apiFetch`, `ApiError` (`client.ts`).
- `useAuthStore`, `AuthUser`, `AuthDevice` (`session.ts`).
- `requestReauthGrant`, `ReauthGrant` (`reauth.ts`).
- `signInWithGoogle` is internal to this package — call via `useAuthStore.signIn()` instead.

## Conventions

- **Session is an HttpOnly cookie set by the backend; CSRF is enforced via `X-Requested-With: fetch`** on `POST`/`PUT`/`PATCH`/`DELETE`. `apiFetch` adds this header automatically — **never bypass `apiFetch`** to call the API.
- **Reauth window is 60 s.** The returned `grantId` must be sent as the `X-Reauth-Grant` header on privileged endpoints (recovery reveal, regenerate, delete-account). Do not cache or retry with an expired grant — call `requestReauthGrant()` again.
- On sign-in, `useAuthStore.signIn()`:
  1. Generates the device keypair via `cryptoWorker.generateAndPersistDeviceKey()` (private key stays in the worker).
  2. Posts the public key + Google `idToken` to `POST /api/v1/auth/google`.
  3. Stashes `pendingDevicePubKey` and `awaitingEnvelope` for the onboarding/devices-waiting flow.
- Network errors propagate as `ApiError` with `status` and `problem.type` so callers can branch on RFC-7807 problem types.

## Gotchas

- `apiFetch` returns `undefined as T` for HTTP 204 — typed as `T` for ergonomics; callers expecting a body for a 204-capable endpoint should handle `undefined`.
- `signIn()` swallows errors into `state.error`; pages should render the error rather than throwing.
- The `awaitingEnvelope` flag is cleared by `liveSync` (`engine.ts` → `device.activated` handler) — do not clear it from the UI prematurely.
- `inferDeviceLabel()` is best-effort; if you change the format, also update the backend's device-label validation.

## Tests

- `reauth.test.ts` covers the 3-step flow. Add new tests for new endpoints by mocking `apiFetch`.
