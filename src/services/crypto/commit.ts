import { sodiumReady } from "./sodium-init";

// v1: HMAC keyed directly under familyKey. Pre-B9 records used this. Kept for
// backwards-compatible verification only — new records use v2 below.
const PREFIX_V1 = new TextEncoder().encode("commit-v1");
// v2: HMAC keyed under a domain-separated subkey derived from familyKey via
// libsodium's BLAKE2b-based KDF (`crypto_kdf_derive_from_key`). This avoids
// using the same key material for both AEAD and the commit MAC and gives the
// commit tag a dedicated, non-reversible subkey (B9).
const PREFIX_V2 = new TextEncoder().encode("commit-v2");

/**
 * Derive the domain-separated commit-tag subkey from the familyKey using
 * libsodium's crypto_kdf_derive_from_key. The 8-byte ASCII context "commitky"
 * (length 8 required by libsodium) plus subkey id 1 gives us a deterministic
 * 32-byte subkey with no overlap with the AEAD key space.
 */
async function deriveCommitKey(familyKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  // crypto_kdf_derive_from_key(subkey_len, subkey_id, ctx (8 bytes ASCII), key)
  return sodium.crypto_kdf_derive_from_key(32, 1, "commitky", familyKey);
}

/**
 * Compute a commit tag for a record blob.
 *
 * `version` selects the algorithm:
 *   - SUITE_VERSION_V1 (0x01): HMAC-SHA256(familyKey, "commit-v1"||nonce)
 *   - SUITE_VERSION_V2 (0x02): HMAC-SHA256(kCommit, "commit-v2"||nonce) where
 *       kCommit = KDF(familyKey, ctx="commitky", id=1)
 *
 * Callers MUST pass the version byte taken from the blob header on decrypt and
 * the current SUITE_VERSION when encrypting. Mixing versions will produce a
 * mismatch and decryption will fail closed.
 */
export async function commitTag(
  familyKey: Uint8Array,
  nonce: Uint8Array,
  version: number,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  if (version === 0x02) {
    const kCommit = await deriveCommitKey(familyKey);
    const input = new Uint8Array(PREFIX_V2.length + nonce.length);
    input.set(PREFIX_V2, 0);
    input.set(nonce, PREFIX_V2.length);
    return sodium.crypto_auth_hmacsha256(input, kCommit);
  }
  // v1 fallback — used only when verifying legacy records.
  const input = new Uint8Array(PREFIX_V1.length + nonce.length);
  input.set(PREFIX_V1, 0);
  input.set(nonce, PREFIX_V1.length);
  return sodium.crypto_auth_hmacsha256(input, familyKey);
}
