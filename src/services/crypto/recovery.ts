// Recovery envelopes per docs/backend/architecture.md §7.3.
//
// No commit tag in recovery envelopes (unlike record blobs §7.1).
// §7.3 omits the commit tag for recovery — Poly1305 authentication is sufficient
// here; the partitioning-oracle defence is only in the record blob path.

import { sodiumReady } from "./sodium-init";
import { deriveRecoveryKey } from "./argon-init";
import { RECOVERY_VERSION_V1 } from "./version";

const TE = new TextEncoder();
const TD = new TextDecoder();

/**
 * Build AAD for recovery envelopes as UTF-8 concatenation (no length-prefixing).
 * Fixed-purpose envelopes don't need the general lp() serialization from aad.ts.
 */
function buildRecoveryAAD(label: string, familyId: string, extra?: string): Uint8Array {
  const labelB = TE.encode(label);
  const familyB = TE.encode(familyId);
  const extraB = extra ? TE.encode(extra) : new Uint8Array(0);
  const out = new Uint8Array(labelB.length + familyB.length + extraB.length);
  out.set(labelB, 0);
  out.set(familyB, labelB.length);
  out.set(extraB, labelB.length + familyB.length);
  return out;
}

/** Pack: [RECOVERY_VERSION_V1(1) | nonce(24) | ct+tag(var)] */
function packEnvelope(nonce: Uint8Array, ct: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 24 + ct.length);
  out[0] = RECOVERY_VERSION_V1;
  out.set(nonce, 1);
  out.set(ct, 25);
  return out;
}

function unpackEnvelope(blob: Uint8Array): { nonce: Uint8Array; ct: Uint8Array } {
  // Minimum: 1 (ver) + 24 (nonce) + 16 (Poly tag, empty plaintext)
  if (blob.length < 1 + 24 + 16) throw new Error("recovery envelope too short");
  const ver = blob[0];
  if (ver !== RECOVERY_VERSION_V1) throw new Error("unsupported recovery envelope version");
  return { nonce: blob.subarray(1, 25), ct: blob.subarray(25) };
}

/**
 * Envelope A (cold recovery): AEAD(kRecovery, familyKey, AAD="recovery-wrap-v1"||familyId||createdAt).
 * kRecovery is derived from the BIP39 phrase via Argon2id.
 */
export async function wrapRecoveryEnvelope(
  familyKey: Uint8Array,
  phrase: string,
  familyId: string,
  createdAt: string,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  const kRecovery = await deriveRecoveryKey(phrase, familyId);
  const nonce = sodium.randombytes_buf(24);
  const aad = buildRecoveryAAD("recovery-wrap-v1", familyId, createdAt);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    familyKey,
    aad,
    null,
    nonce,
    kRecovery,
  );
  return packEnvelope(nonce, ct);
}

export async function unwrapRecoveryEnvelope(
  envelope: Uint8Array,
  phrase: string,
  familyId: string,
  createdAt: string,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  const kRecovery = await deriveRecoveryKey(phrase, familyId);
  const { nonce, ct } = unpackEnvelope(envelope);
  const aad = buildRecoveryAAD("recovery-wrap-v1", familyId, createdAt);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad, nonce, kRecovery);
}

/**
 * Envelope B (warm reveal): AEAD(familyKey, phrase, AAD="recovery-reveal-v1"||familyId).
 * Used in Settings → Security → "Show recovery code".
 */
export async function wrapPhraseForReveal(
  phrase: string,
  familyKey: Uint8Array,
  familyId: string,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  const nonce = sodium.randombytes_buf(24);
  const aad = buildRecoveryAAD("recovery-reveal-v1", familyId);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    TE.encode(phrase),
    aad,
    null,
    nonce,
    familyKey,
  );
  return packEnvelope(nonce, ct);
}

export async function unwrapPhraseForReveal(
  envelope: Uint8Array,
  familyKey: Uint8Array,
  familyId: string,
): Promise<string> {
  const sodium = await sodiumReady();
  const { nonce, ct } = unpackEnvelope(envelope);
  const aad = buildRecoveryAAD("recovery-reveal-v1", familyId);
  const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad, nonce, familyKey);
  return TD.decode(pt);
}
