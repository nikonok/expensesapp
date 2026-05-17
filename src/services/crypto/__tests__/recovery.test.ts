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
  it("round-trips the recovery phrase", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID);
    const recovered = await unwrapPhraseForReveal(envelope, familyKey, FAMILY_ID);
    expect(recovered).toBe(PHRASE);
  });

  it("rejects wrong familyKey", async () => {
    const keyA = randomKey();
    const keyB = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, keyA, FAMILY_ID);
    await expect(unwrapPhraseForReveal(envelope, keyB, FAMILY_ID)).rejects.toThrow();
  });

  it("rejects wrong familyId", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID);
    await expect(
      unwrapPhraseForReveal(envelope, familyKey, "00000000-0000-7000-8000-000000000002"),
    ).rejects.toThrow();
  });

  it("rejects tampered envelope bytes", async () => {
    const familyKey = randomKey();
    const envelope = await wrapPhraseForReveal(PHRASE, familyKey, FAMILY_ID);
    const tampered = new Uint8Array(envelope);
    tampered[30] ^= 0xff;
    await expect(unwrapPhraseForReveal(tampered, familyKey, FAMILY_ID)).rejects.toThrow();
  });
});
