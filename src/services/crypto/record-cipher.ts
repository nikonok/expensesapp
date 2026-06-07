import { sodiumReady } from "./sodium-init";
import { serializeAAD, type AADInput } from "./aad";
import { commitTag } from "./commit";
import { SUITE_VERSION_V1, SUITE_VERSION_V2 } from "./version";

export interface RecordMeta extends Omit<AADInput, "nonce" | "plaintextByteCount"> {
  // nonce + plaintextByteCount are filled in by encrypt / derived on decrypt
}

export interface EncryptedRecord {
  blob: Uint8Array; // [ver(1)|nonce(24)|commit(32)|ct+tag(var)]
  nonce: Uint8Array; // 24 bytes — caller may want for storage / AAD verification
  plaintextByteCount: number;
}

export async function encryptRecord(
  plaintext: Uint8Array,
  familyKey: Uint8Array,
  meta: RecordMeta,
): Promise<EncryptedRecord> {
  const sodium = await sodiumReady();
  const nonce = sodium.randombytes_buf(24);
  const aad = await serializeAAD({ ...meta, nonce, plaintextByteCount: plaintext.length });
  // combined-mode: ciphertext includes the 16-byte Poly1305 tag appended
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    familyKey,
  );
  // New records use SUITE_VERSION_V2 — commit tag is HMAC'd under a
  // domain-separated kCommit derived from familyKey via libsodium KDF (B9).
  const commit = await commitTag(familyKey, nonce, SUITE_VERSION_V2);

  // Blob layout: [ver(1) | nonce(24) | commit(32) | ct+tag(var)]
  const blob = new Uint8Array(1 + 24 + 32 + ct.length);
  blob[0] = SUITE_VERSION_V2;
  blob.set(nonce, 1);
  blob.set(commit, 25);
  blob.set(ct, 57);

  return { blob, nonce, plaintextByteCount: plaintext.length };
}

export interface DecryptInput {
  blob: Uint8Array;
  familyKey: Uint8Array;
  // caller knows everything except nonce; nonce comes from blob
  meta: Omit<RecordMeta, "nonce">;
}

export async function decryptRecord(input: DecryptInput): Promise<Uint8Array> {
  const sodium = await sodiumReady();

  // Minimum: 1 (ver) + 24 (nonce) + 32 (commit) + 16 (Poly tag, empty plaintext)
  if (input.blob.length < 1 + 24 + 32 + 16) throw new Error("blob too short");

  const ver = input.blob[0];
  if (ver !== SUITE_VERSION_V1 && ver !== SUITE_VERSION_V2) {
    throw new Error("unsupported suite version: " + ver);
  }

  const nonce = input.blob.subarray(1, 25);
  const storedCommit = input.blob.subarray(25, 57);
  const ct = input.blob.subarray(57);

  // Verify commit tag before attempting decryption (constant-time compare).
  // Compute under whichever scheme the blob's version byte selects — v1 uses
  // the legacy HMAC-under-familyKey path, v2 (B9) uses the KDF-derived kCommit.
  const expectedCommit = await commitTag(input.familyKey, nonce, ver);
  if (!sodium.memcmp(storedCommit, expectedCommit)) throw new Error("commit tag mismatch");

  const ptByteCount = ct.length - 16; // Poly tag is 16 bytes
  const aad = await serializeAAD({
    ...input.meta,
    nonce,
    plaintextByteCount: ptByteCount,
  });

  // combined-mode decrypt: first arg (secret_nonce) is null per AEAD IETF API
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad, nonce, input.familyKey);
}
