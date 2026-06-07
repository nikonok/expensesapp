// @vitest-environment node

import { describe, it, expect } from "vitest";
import { encryptRecord, decryptRecord, type RecordMeta } from "../record-cipher";
import { commitTag } from "../commit";
import { serializeAAD } from "../aad";
import { sodiumReady } from "../sodium-init";
import { SUITE_VERSION_V1 } from "../version";

function randomKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}

const BASE_META: RecordMeta = {
  verByte: 1,
  familyId: "00000000-0000-7000-8000-000000000001",
  recordId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  recordType: "transaction",
  addedByUserId: "user-001",
  editedByUserId: "user-001",
  updatedAtMap: { amount: "2024-01-01T00:00:00.000Z" },
  deletedAt: "",
};

describe("encryptRecord / decryptRecord", () => {
  it("round-trips plaintext", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("hello world");
    const { blob } = await encryptRecord(plaintext, familyKey, BASE_META);
    const recovered = await decryptRecord({ blob, familyKey, meta: BASE_META });
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it("rejects tampered recordId in meta", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("secret");
    const { blob } = await encryptRecord(plaintext, familyKey, BASE_META);
    const tamperedMeta = { ...BASE_META, recordId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    await expect(decryptRecord({ blob, familyKey, meta: tamperedMeta })).rejects.toThrow();
  });

  it("rejects tampered updatedAtMap in meta", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("secret");
    const { blob } = await encryptRecord(plaintext, familyKey, BASE_META);
    const tamperedMeta = {
      ...BASE_META,
      updatedAtMap: { amount: "2099-12-31T00:00:00.000Z" },
    };
    await expect(decryptRecord({ blob, familyKey, meta: tamperedMeta })).rejects.toThrow();
  });

  it("rejects tampered deletedAt in meta", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("secret");
    const { blob } = await encryptRecord(plaintext, familyKey, BASE_META);
    const tamperedMeta = { ...BASE_META, deletedAt: "2024-01-01T00:00:00.000Z" };
    await expect(decryptRecord({ blob, familyKey, meta: tamperedMeta })).rejects.toThrow();
  });

  it("rejects a flipped byte in the commit-tag section", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("secret");
    const { blob } = await encryptRecord(plaintext, familyKey, BASE_META);
    // commit tag occupies bytes 25–56 (32 bytes)
    const tampered = new Uint8Array(blob);
    tampered[30] ^= 0xff;
    await expect(decryptRecord({ blob: tampered, familyKey, meta: BASE_META })).rejects.toThrow(
      "commit tag mismatch",
    );
  });

  it("rejects a wrong familyKey", async () => {
    const keyA = randomKey();
    const keyB = randomKey();
    const plaintext = new TextEncoder().encode("secret");
    const { blob } = await encryptRecord(plaintext, keyA, BASE_META);
    await expect(decryptRecord({ blob, familyKey: keyB, meta: BASE_META })).rejects.toThrow();
  });

  it("rejects a blob that is too short", async () => {
    const familyKey = randomKey();
    const shortBlob = new Uint8Array(10);
    await expect(decryptRecord({ blob: shortBlob, familyKey, meta: BASE_META })).rejects.toThrow(
      "blob too short",
    );
  });

  it("rejects an unknown version byte", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("v");
    const { blob } = await encryptRecord(plaintext, familyKey, BASE_META);
    const tampered = new Uint8Array(blob);
    tampered[0] = 0x99;
    await expect(decryptRecord({ blob: tampered, familyKey, meta: BASE_META })).rejects.toThrow(
      "unsupported suite version",
    );
  });

  it("exposes correct nonce and plaintextByteCount", async () => {
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("measure me");
    const { nonce, plaintextByteCount } = await encryptRecord(plaintext, familyKey, BASE_META);
    expect(nonce.length).toBe(24);
    expect(plaintextByteCount).toBe(plaintext.length);
  });

  it("emits SUITE_VERSION_V2 (0x02) for new blobs (B9 commit-tag KDF)", async () => {
    const familyKey = randomKey();
    const { blob } = await encryptRecord(new TextEncoder().encode("v"), familyKey, BASE_META);
    expect(blob[0]).toBe(0x02);
  });

  it("backwards-compat: still decrypts a v1 blob (commit tag HMAC'd under familyKey)", async () => {
    // Synthesize a legacy v1 blob: version byte 0x01, commit tag computed via
    // the v1 path (HMAC under familyKey directly). The decrypt path must accept
    // it so any blobs persisted before the B9 bump continue to verify.
    const sodium = await sodiumReady();
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("legacy v1 record");

    const nonce = sodium.randombytes_buf(24);
    const aad = await serializeAAD({
      ...BASE_META,
      nonce,
      plaintextByteCount: plaintext.length,
    });
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      aad,
      null,
      nonce,
      familyKey,
    );
    const commit = await commitTag(familyKey, nonce, SUITE_VERSION_V1);

    const blob = new Uint8Array(1 + 24 + 32 + ct.length);
    blob[0] = SUITE_VERSION_V1;
    blob.set(nonce, 1);
    blob.set(commit, 25);
    blob.set(ct, 57);

    const recovered = await decryptRecord({ blob, familyKey, meta: BASE_META });
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it("rejects a v2 blob whose commit tag was computed under v1 (cross-version mismatch)", async () => {
    // Belt-and-suspenders: if an attacker (or a buggy older client) swaps just
    // the version byte without recomputing the commit tag, decryption fails.
    const sodium = await sodiumReady();
    const familyKey = randomKey();
    const plaintext = new TextEncoder().encode("mixed");

    const nonce = sodium.randombytes_buf(24);
    const aad = await serializeAAD({
      ...BASE_META,
      nonce,
      plaintextByteCount: plaintext.length,
    });
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      aad,
      null,
      nonce,
      familyKey,
    );
    // Commit tag intentionally derived under v1
    const commitV1 = await commitTag(familyKey, nonce, SUITE_VERSION_V1);
    const blob = new Uint8Array(1 + 24 + 32 + ct.length);
    blob[0] = 0x02; // claim v2
    blob.set(nonce, 1);
    blob.set(commitV1, 25);
    blob.set(ct, 57);

    await expect(decryptRecord({ blob, familyKey, meta: BASE_META })).rejects.toThrow(
      "commit tag mismatch",
    );
  });
});
