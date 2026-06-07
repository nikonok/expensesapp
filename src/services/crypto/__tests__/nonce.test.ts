// @vitest-environment node
//
// Nonce-uniqueness regression test (B9).
//
// XChaCha20-Poly1305 catastrophically loses confidentiality under nonce reuse.
// `encryptRecord` MUST draw a fresh 24-byte nonce from
// `sodium.randombytes_buf(24)` for every encryption — never derive it from the
// plaintext, never cache it, never re-use across messages. This file is a
// defence-in-depth check: encrypt the same (plaintext, key, meta) 1000 times
// and assert all 1000 nonces are distinct.

import { describe, it, expect } from "vitest";
import { encryptRecord, type RecordMeta } from "../record-cipher";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

describe("nonce uniqueness", () => {
  it("encryptRecord generates a unique 24-byte nonce on every call (1000 iterations)", async () => {
    const familyKey = new Uint8Array(32);
    crypto.getRandomValues(familyKey);

    const meta: RecordMeta = {
      verByte: 1,
      familyId: "00000000-0000-7000-8000-000000000001",
      recordId: "aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee",
      recordType: "transaction",
      addedByUserId: "user-001",
      editedByUserId: "user-001",
      updatedAtMap: { amount: "2024-01-01T00:00:00.000Z" },
      deletedAt: "",
    };

    const plaintext = new TextEncoder().encode("the same plaintext, every iteration");

    const N = 1000;
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) {
      const { nonce } = await encryptRecord(plaintext, familyKey, meta);
      expect(nonce.length).toBe(24);
      seen.add(toHex(nonce));
    }

    expect(seen.size).toBe(N);
  });

  it("encryptRecord produces a different blob ciphertext on every call (same input)", async () => {
    // Sanity check that the differing nonce actually changes the resulting blob
    // — defends against an accidental change that fixed the nonce but kept
    // randomness elsewhere.
    const familyKey = new Uint8Array(32);
    crypto.getRandomValues(familyKey);

    const meta: RecordMeta = {
      verByte: 1,
      familyId: "00000000-0000-7000-8000-000000000001",
      recordId: "aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee",
      recordType: "transaction",
      addedByUserId: "user-001",
      editedByUserId: "user-001",
      updatedAtMap: { amount: "2024-01-01T00:00:00.000Z" },
      deletedAt: "",
    };
    const plaintext = new TextEncoder().encode("identical plaintext");

    const a = await encryptRecord(plaintext, familyKey, meta);
    const b = await encryptRecord(plaintext, familyKey, meta);
    expect(toHex(a.blob)).not.toBe(toHex(b.blob));
  });
});
