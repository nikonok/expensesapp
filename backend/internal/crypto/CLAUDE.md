# internal/crypto

> Link to repo root: [../../../CLAUDE.md](../../../CLAUDE.md)

## Purpose

Server-side AAD (Additional Authenticated Data) serializer. The server never
encrypts or decrypts user data — this package exists so the server can verify on
push that record metadata matches what the client bound into the AEAD ciphertext.

## Key files

- `aad.go` — `SerializeAAD(AADInput) ([]byte, error)`; length-prefixed canonical encoding per `docs/backend/architecture.md` §7.4.
- `aadgen_test.go` — golden-vector test; loads `testdata/aad-vectors.json` and asserts byte-exact output.
- `testdata/aad-vectors.json` — shared golden vectors; the TS implementation in `src/services/crypto/aad.ts` MUST produce the same bytes for every vector.

## Public surface

- `AADInput` — input struct (familyID, recordID, recordType, addedByUserId, editedByUserId, updatedAtMap, deletedAt, plaintextByteCount, nonce).
- `SerializeAAD` — only exported function; returns the canonical bytes or an error if nonce length is wrong.

## Conventions

- All ID fields are encoded as their UTF-8 representation (the 36-char dashed UUID string). NOT 16 raw bytes. Both Go and TS must agree.
- Fixed prefix bytes: `"expapp-rec-v1"` (13 bytes), followed by `ver_byte` (1 byte).
- Every variable-length field is length-prefixed: `uint32_be(len) || bytes`.
- `updatedAtMap` digest is `SHA-256` over sorted `key=value\n` pairs (lexicographic). An empty map digests to `SHA-256("")`.
- `deletedAt == ""` MUST encode as a zero-length LP, not as the literal empty string with prefix overhead — but the implementation already uses `lp(nil)`, do not change.
- `plaintextByteCount` is `uint32_be` — confirm the client never overflows this (currently bounded by 8 MiB push limit).
- `Nonce` MUST be exactly 24 bytes (XChaCha20-Poly1305 nonce). Wrong length ⇒ explicit error.

## Gotchas

- Any byte change here is a wire-protocol break. Bump `ver_byte` and add a new vector set; never silently change layout.
- Do NOT add helper functions that encrypt or decrypt — those live client-side only. The server seeing plaintext is a protocol violation.
- The TS port lives at `src/services/crypto/aad.ts`. Run frontend tests (`npm test`) AFTER any change to confirm vectors still match.

## Tests

- `aad_test.go` — unit tests for empty map digest, nonce length validation, deletedAt handling.
- `aadgen_test.go` — golden-vector parity test (`testdata/aad-vectors.json`).
- To add new field semantics: append a new vector AND mirror the change in the TS port; both test suites must pass before commit.
