// Generates familyKey + 24-word BIP39 phrase + envelopes, calls POST /api/v1/family/init,
// then persists familyKey + devicePrivKey in IndexedDB via the cipherKeys table.
// Returns the 24-word phrase for display to the user.

import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { apiFetch } from "../auth/client";
import { db } from "@/db/database";

/**
 * Derive the 16-byte Argon2 salt via HKDF-SHA256.
 * IKM = UTF-8 bytes of familyId, Info = "argon2-recovery-v1", empty extract-salt.
 * Duplicates the logic from argon-init.ts (not imported to avoid pulling argon2-browser
 * into the main bundle — argon2 WASM must remain worker-only).
 */
async function deriveArgon2Salt(familyId: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(familyId),
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: enc.encode("argon2-recovery-v1"),
    },
    keyMaterial,
    128,
  );
  return new Uint8Array(bits);
}

/** Encode a Uint8Array to base64url (no padding). */
function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Hand-rolled UUIDv7: 48-bit ms timestamp | 4-bit version (7) | 12-bit seq |
 * 2-bit variant | 62-bit random.
 * Per RFC 9562 §5.7.
 */
function uuidv7(): string {
  const ms = BigInt(Date.now());
  // 6 random bytes for seq + rand
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  const randHi = BigInt(rand[0]) & 0x0fn; // 4-bit sequence high
  const randMid = BigInt(rand[1]); // 8-bit sequence low
  const seq = (randHi << 8n) | randMid; // 12-bit seq

  // Build 128-bit value
  // bits [127:80] = timestamp (48 bits)
  // bits [79:76]  = 0x7 (version 7)
  // bits [75:64]  = seq (12 bits)
  // bits [63:62]  = 0b10 (variant RFC 4122)
  // bits [61:0]   = random (62 bits)
  const randLow =
    ((BigInt(rand[2]) & 0x3fn) << 56n) |
    (BigInt(rand[3]) << 48n) |
    (BigInt(rand[4]) << 40n) |
    (BigInt(rand[5]) << 32n) |
    (BigInt(rand[6]) << 24n) |
    (BigInt(rand[7]) << 16n) |
    (BigInt(rand[8]) << 8n) |
    BigInt(rand[9]);

  const hi64 = (ms << 16n) | (0x7n << 12n) | seq;
  const lo64 = (0x8n << 60n) | randLow;

  const hex = hi64.toString(16).padStart(16, "0") + lo64.toString(16).padStart(16, "0");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export async function initFamilyAndShowPhrase(opts: {
  devicePubKey: Uint8Array;
  devicePrivKey: Uint8Array;
}): Promise<{ familyId: string; phrase: string }> {
  const { devicePubKey, devicePrivKey } = opts;

  // 1. Generate identifiers and key material
  const familyId = uuidv7();
  const createdAt = new Date().toISOString();

  // 32-byte random familyKey generated on main thread — entropy only, no
  // sensitive processing; actual wrapping happens inside the worker.
  const familyKey = new Uint8Array(32);
  crypto.getRandomValues(familyKey);

  // 2. Generate 24-word BIP39 phrase (strength=256 → 24 words)
  const phrase = bip39.generateMnemonic(wordlist, 256);

  // Dynamic import keeps the Web Worker bundle out of the initial chunk.
  const { cryptoWorker } = await import("../crypto/worker-client");

  // 3. Wrap key for device (Envelope C — sealed box, 80 bytes)
  const deviceEnvelopeBytes = await cryptoWorker.wrapKeyForDevice(familyKey, devicePubKey);

  // 4. Wrap recovery envelope — Envelope A: AEAD(kRecovery, familyKey)
  const wrapBytes = await cryptoWorker.wrapRecoveryEnvelope(familyKey, phrase, familyId, createdAt);

  // 5. Wrap phrase for warm reveal — Envelope B: AEAD(familyKey, phrase)
  const phraseCt = await cryptoWorker.wrapPhraseForReveal(phrase, familyKey, familyId);

  // 6. Derive the Argon2 salt (deterministic from familyId via HKDF-SHA256)
  const salt = await deriveArgon2Salt(familyId);

  // 7. POST /api/v1/family/init
  await apiFetch<unknown>("/api/v1/family/init", {
    method: "POST",
    body: JSON.stringify({
      familyId,
      deviceEnvelope: toBase64Url(deviceEnvelopeBytes),
      recovery: {
        wrap: toBase64Url(wrapBytes),
        phraseCt: toBase64Url(phraseCt),
        salt: toBase64Url(salt),
      },
    }),
  });

  // 8. Persist familyKey and device keys in IndexedDB
  const now = new Date().toISOString();
  await db.transaction("rw", db.cipherKeys, async () => {
    await db.cipherKeys.put({ name: "familyKey", value: familyKey, createdAt: now });
    await db.cipherKeys.put({ name: "devicePrivKey", value: devicePrivKey, createdAt: now });
    await db.cipherKeys.put({ name: "devicePubKey", value: devicePubKey, createdAt: now });
  });

  return { familyId, phrase };
}
