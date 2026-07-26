// Argon2id key derivation via libsodium's crypto_pwhash. Used only on recovery
// paths (cold restore from 24-word phrase, recovery code regeneration).
//
// Parameters (frozen — changing any of them breaks every existing recovery
// envelope):
//   memory:  65536 KiB (64 MiB)
//   t:       3
//   p:       1 (libsodium's argon2id13 always uses a single lane)
//   output:  32 bytes
//
// Salt: HKDF-SHA256(ikm=familyId UTF-8, info="argon2-recovery-v1", length=16).
// HKDF is implemented via Web Crypto (crypto.subtle) — libsodium-wrappers-sumo
// 0.7.x does not export crypto_kdf_hkdf_sha256_extract/_expand.
//
// Implementation note: this previously used argon2-browser via a
// `/* @vite-ignore */` dynamic import. That left a bare `import("argon2-browser")`
// in the production bundle, which no browser can resolve — recovery-key
// derivation (and therefore family init / "encryption setup") failed in every
// production build while working in dev and in Vitest. libsodium's
// crypto_pwhash with ALG_ARGON2ID13 produces byte-identical output for these
// parameters (verified against Go x/crypto/argon2 — see the pinned vector in
// __tests__/argon.test.ts), and the sumo WASM is already loaded by the crypto
// worker, so no separate argon2 WASM is needed at all.

import { sodiumReady } from "./sodium-init";

const ARGON_OPSLIMIT = 3;
const ARGON_MEMLIMIT_BYTES = 65536 * 1024; // 64 MiB

/**
 * Derive a 16-byte salt via HKDF-SHA256.
 * IKM = UTF-8 bytes of familyId.
 * Info = UTF-8 "argon2-recovery-v1".
 * Salt for HKDF extract = empty (RFC 5869 §2.2 default: HashLen zero-bytes).
 * Output length = 16 bytes.
 *
 * Uses Web Crypto (crypto.subtle) — available in browsers and Node ≥18.
 */
async function deriveSalt(familyId: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const ikm = enc.encode(familyId);
  const info = enc.encode("argon2-recovery-v1");

  const keyMaterial = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, [
    "deriveBits",
  ]);

  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0), // empty salt → RFC 5869 §2.2 default
      info,
    },
    keyMaterial,
    128, // 16 bytes × 8 bits
  );

  return new Uint8Array(bits);
}

/**
 * Derive a 32-byte recovery key from a BIP39 24-word phrase and the family id.
 * Returns Uint8Array(32).
 */
export async function deriveRecoveryKey(phrase: string, familyId: string): Promise<Uint8Array> {
  const [sodium, salt] = await Promise.all([sodiumReady(), deriveSalt(familyId)]);
  return sodium.crypto_pwhash(
    32,
    phrase,
    salt,
    ARGON_OPSLIMIT,
    ARGON_MEMLIMIT_BYTES,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}
