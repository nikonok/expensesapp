# src/services/crypto

[root CLAUDE.md](../../../CLAUDE.md)

## Purpose

Client-side end-to-end encryption: device keypairs, family-key envelopes, record encrypt/decrypt, BIP39 recovery, and the dedicated Web Worker that holds raw key material.

## Key files

- `worker.ts` — the Web Worker entrypoint; persists `familyKey` and device private key inside its own IndexedDB scope. Never imported directly from the main thread.
- `worker-client.ts` — typed RPC proxy (`cryptoWorker.*`). Single supported way to call crypto from the main thread.
- `record-cipher.ts` — XChaCha20-Poly1305 record encrypt/decrypt; produces blob = `nonce(24) || ct || tag`.
- `envelope.ts` — sealed-box device envelopes (80 bytes) for wrapping `familyKey` to a device public key.
- `recovery.ts` — Envelope A (BIP39 recovery wrap) and Envelope B (phrase ciphertext for reveal).
- `aad.ts` — canonical AAD serializer. MUST stay byte-identical to `backend/internal/crypto/aad.go`.
- `commit.ts` — `commit` payload helper (Argon2id-based recovery key derivation).
- `argon-init.ts`, `sodium-init.ts` — lazy WASM init for argon2 and libsodium.
- `version.ts` — current AAD/format `verByte` constant.
- `__tests__/` — vector tests for AAD, record-cipher, envelope, recovery.

## Public surface

- `cryptoWorker` (from `worker-client.ts`) — only entrypoint other packages should call.
- `serializeAAD` (`aad.ts`) — exported for the worker and golden-vector tests; do not call from main-thread code paths outside crypto.
- Everything else (raw record-cipher, envelope, recovery primitives) is **internal** — do not import from outside `src/services/crypto`.

## Conventions

- **The server NEVER sees plaintext financial fields.** Only `(blob, AAD inputs)` may leave the device for synced records.
- **AAD vectors are golden between Go and TS.** Reference: `backend/internal/crypto/testdata/aad-vectors.json`. Any change to `aad.ts` requires synchronised change to `backend/internal/crypto/aad.go` plus refreshed vectors.
- **Nonces MUST come from `sodium.randombytes_buf(24)`** — never reuse, never derive deterministically. See `record-cipher.ts:22`, `recovery.ts:58,93`.
- **Never accept a raw `Uint8Array` familyKey as a parameter across postMessage** from outside the worker. The worker owns the key; main-thread RPCs must use the `*WithStoredKey` variants. The `encryptRecord` / `decryptRecord` RPCs that take a `familyKey` parameter are reserved for the migration path (`family/migrate.ts`) where the new family key is unwrapped client-side.
- Wrap blobs/envelopes as base64url **without padding** when crossing JSON boundaries (see `engine.ts` helpers).
- libsodium uses the "sumo" build — never switch to the lite build.

## Gotchas

- `worker-client.ts` lazy-creates a singleton Worker; on crash it nulls the reference and re-spawns on next call. Pending RPCs are rejected.
- `sodium-init.ts` relies on a Vite alias forcing the CJS bundle; do not switch to `import * as sodium`.
- `aad.ts` uses an async SHA-256 for the `updatedAtMap` digest — the function is `async` for that reason.
- `unwrapAndPersistFamilyKey` and `wrapStoredFamilyKeyForDevice` are the only safe ways to move a family key between devices — both keep the raw key inside the worker.

## Tests

- `__tests__/aad-vectors.test.ts` (compares against the shared JSON file), `__tests__/record-cipher.test.ts`, `__tests__/envelope.test.ts`, `__tests__/recovery.test.ts`.
- Add tests next to existing fixtures; do not introduce per-test random keys without seeding.
