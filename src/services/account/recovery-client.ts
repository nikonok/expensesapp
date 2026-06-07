// Client-side recovery-code operations (architecture §8.12, §9.6).
// Envelope B reveal: decrypt phraseCt with the stored familyKey via the crypto worker.

import { apiFetch } from "../auth/client";

/**
 * Reveals the 24-word recovery phrase by:
 *  1. POST /api/v1/account/recovery/reveal (header X-Reauth-Grant)
 *     → {phraseCt, saltB64, familyId, createdAt}
 *  2. Decrypt Envelope B via the crypto worker using the stored familyKey.
 *
 * `createdAt` is required by Envelope B v2 AAD (B9) so a malicious server
 * cannot roll back to a prior envelope undetected. Pre-B9 envelopes (v1)
 * are still accepted by the worker without a createdAt match.
 *
 * Requires a valid grantId from requestReauthGrant().
 */
export async function revealRecoveryPhrase(grantId: string, familyId: string): Promise<string> {
  const resp = await apiFetch<{
    phraseCt: string;
    saltB64: string;
    familyId?: string;
    createdAt?: string;
  }>("/api/v1/account/recovery/reveal", {
    method: "POST",
    headers: { "X-Reauth-Grant": grantId },
  });
  const phraseCtB64u = resp.phraseCt;
  const createdAt = resp.createdAt ?? "";

  // Decode base64url → Uint8Array
  const padded = phraseCtB64u.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  const binary = atob(b64);
  const phraseCt = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) phraseCt[i] = binary.charCodeAt(i);

  // Dynamic import keeps the Web Worker bundle out of the initial chunk.
  const { cryptoWorker } = await import("../crypto/worker-client");
  return cryptoWorker.unwrapStoredPhraseForReveal(phraseCt, familyId, createdAt);
}
