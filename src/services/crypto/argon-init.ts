// Lazy-loaded Argon2id key derivation. Used only on recovery paths
// (cold restore from 24-word phrase, recovery code regeneration).
//
// Parameters from docs/backend/architecture.md §7.3:
//   memory:  65536 KiB (64 MiB)
//   t:       3
//   p:       1
//   output:  32 bytes
//
// Salt: HKDF-SHA256(ikm=familyId UTF-8, info="argon2-recovery-v1", length=16).
// HKDF is implemented via Web Crypto (crypto.subtle) — libsodium-wrappers-sumo
// 0.7.x does not export crypto_kdf_hkdf_sha256_extract/_expand.

import type { hash as Argon2Hash } from "argon2-browser";

type HashFn = typeof Argon2Hash;

let hashFn: HashFn | null = null;

async function argonReady(): Promise<HashFn> {
  if (hashFn) return hashFn;
  // Dynamic import triggers WASM load only on recovery paths.
  // @vite-ignore: keep this import dynamic at runtime; don't try to bundle argon2-browser
  // into the worker chunk at build time — it contains a Node-only require('../dist/argon2.wasm')
  // that rolldown cannot resolve as a static asset.
  const mod = await import(/* @vite-ignore */ "argon2-browser");
  // argon2-browser ships as a CJS module; the hash function may be on the
  // default export or as a named export depending on the bundler.
  hashFn = (mod.hash ?? (mod as unknown as { default: { hash: HashFn } }).default?.hash) as HashFn;
  return hashFn;
}

// argon2-browser ArgonType enum: 0=Argon2d, 1=Argon2i, 2=Argon2id
const ARGON2ID_TYPE = 2;

const ARGON_PARAMS = {
  time: 3,
  mem: 65536, // 64 MiB in KiB
  hashLen: 32,
  parallelism: 1,
  type: ARGON2ID_TYPE,
} as const;

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
  const [hash, salt] = await Promise.all([argonReady(), deriveSalt(familyId)]);
  const result = await hash({
    pass: phrase,
    salt,
    ...ARGON_PARAMS,
  });
  return result.hash;
}
