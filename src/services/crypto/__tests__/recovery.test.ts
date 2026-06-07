// @vitest-environment node

import { describe, it, expect, vi } from "vitest";

// Mock argon2-browser — same pattern as argon.test.ts.
// WASM loads via fetch() which fails in Vitest's Node environment.
vi.mock("argon2-browser", () => {
  return {
    hash: vi.fn((params: { pass: string | Uint8Array; salt: Uint8Array; hashLen?: number }) => {
      const passBytes = new TextEncoder().encode(
        params.pass instanceof Uint8Array
          ? new TextDecoder().decode(params.pass)
          : (params.pass as string),
      );
      const salt = params.salt;
      const hashLen = params.hashLen ?? 32;
      const hash = new Uint8Array(hashLen);
      for (let i = 0; i < hashLen; i++) {
        hash[i] = (passBytes[i % passBytes.length] ?? 0) ^ (salt[i % salt.length] ?? 0);
      }
      return Promise.resolve({ hash, hashHex: "", encoded: "" });
    }),
    ArgonType: { Argon2d: 0, Argon2i: 1, Argon2id: 2 },
  };
});

import {
  wrapRecoveryEnvelope,
  unwrapRecoveryEnvelope,
  wrapPhraseForReveal,
  unwrapPhraseForReveal,
} from "../recovery";

function randomKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const FAMILY_ID = "00000000-0000-7000-8000-000000000001";
const CREATED_AT = "2024-01-01T00:00:00.000Z";

describe("wrapRecoveryEnvelope / unwrapRecoveryEnvelope (Envelope A)", () => {
  it("round-trips familyKey", async () => {
    const familyKey = randomKey();
    const envelope = await wrapRecoveryEnvelope(familyKey, PHRASE, FAMILY_ID, CREATED_AT);
    const recovered = await unwrapRecoveryEnvelope(envelope, PHRASE, FAMILY_ID, CREATED_AT);
    expect(Array.from(recovered)).toEqual(Array.from(familyKey));
  });

  it("rejects wrong phrase", async () => {
    const familyKey = randomKey();
    const envelope = await wrapRecoveryEnvelope(familyKey, PHRASE, FAMILY_ID, CREATED_AT);
    await expect(
      unwrapRecoveryEnvelope(envelope, "wrong phrase words here", FAMILY_ID, CREATED_AT),
    ).rejects.toThrow();
  });

  it("rejects wrong familyId", async () => {
    const familyKey = randomKey();
    const envelope = await wrapRecoveryEnvelope(familyKey, PHRASE, FAMILY_ID, CREATED_AT);
    await expect(
      unwrapRecoveryEnvelope(envelope, PHRASE, "00000000-0000-7000-8000-000000000002", CREATED_AT),
    ).rejects.toThrow();
  });

  it("rejects tampered envelope bytes", async () => {
    const familyKey = randomKey();
    const envelope = await wrapRecoveryEnvelope(familyKey, PHRASE, FAMILY_ID, CREATED_AT);
    const tampered = new Uint8Array(envelope);
    tampered[30] ^= 0xff;
    await expect(unwrapRecoveryEnvelope(tampered, PHRASE, FAMILY_ID, CREATED_AT)).rejects.toThrow();
  });
});

describe("wrapPhraseForReveal / unwrapPhraseForReveal (Envelope B)", () => {
  it("round-trips the recovery phrase (v2 binds createdAt)", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID, CREATED_AT);
    const recovered = await unwrapPhraseForReveal(envelope, familyKey, FAMILY_ID, CREATED_AT);
    expect(recovered).toBe(PHRASE);
  });

  it("emits a v2 envelope by default (version byte 0x21)", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID, CREATED_AT);
    expect(envelope[0]).toBe(0x21);
  });

  it("rejects wrong familyKey", async () => {
    const keyA = randomKey();
    const keyB = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, keyA, FAMILY_ID, CREATED_AT);
    await expect(unwrapPhraseForReveal(envelope, keyB, FAMILY_ID, CREATED_AT)).rejects.toThrow();
  });

  it("rejects wrong familyId", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID, CREATED_AT);
    await expect(
      unwrapPhraseForReveal(
        envelope,
        familyKey,
        "00000000-0000-7000-8000-000000000002",
        CREATED_AT,
      ),
    ).rejects.toThrow();
  });

  it("rejects mismatched createdAt — defeats rollback to prior envelope (v2 AAD binding)", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID, CREATED_AT);
    // A different createdAt (e.g. the server replaying an older envelope) must
    // fail AEAD verification because createdAt is in the AAD.
    await expect(
      unwrapPhraseForReveal(envelope, familyKey, FAMILY_ID, "2023-01-01T00:00:00.000Z"),
    ).rejects.toThrow();
  });

  it("rejects tampered envelope bytes", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID, CREATED_AT);
    const tampered = new Uint8Array(envelope);
    tampered[30] ^= 0xff;
    await expect(
      unwrapPhraseForReveal(tampered, familyKey, FAMILY_ID, CREATED_AT),
    ).rejects.toThrow();
  });

  it("backwards-compat: still decrypts a v1 envelope (no createdAt binding)", async () => {
    // Synthesize a v1 envelope: same plaintext encrypted with AAD = label||familyId
    // (no createdAt) and version byte 0x20. The unwrap path must still accept it
    // so previously-stored Envelope B blobs continue to work after the B9 bump.
    const { sodiumReady } = await import("../sodium-init");
    const sodium = await sodiumReady();
    const familyKey = randomKey();
    const TE = new TextEncoder();
    const label = TE.encode("recovery-reveal-v1");
    const fam = TE.encode(FAMILY_ID);
    const aad = new Uint8Array(label.length + fam.length);
    aad.set(label, 0);
    aad.set(fam, label.length);
    const nonce = sodium.randombytes_buf(24);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      TE.encode(PHRASE),
      aad,
      null,
      nonce,
      familyKey,
    );
    const v1 = new Uint8Array(1 + 24 + ct.length);
    v1[0] = 0x20; // RECOVERY_VERSION_V1
    v1.set(nonce, 1);
    v1.set(ct, 25);

    // Decrypt with any createdAt — v1 ignores it.
    const recovered = await unwrapPhraseForReveal(v1, familyKey, FAMILY_ID, "anything");
    expect(recovered).toBe(PHRASE);
  });
});
