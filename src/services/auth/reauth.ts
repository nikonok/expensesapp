// Client-side reauth ceremony (architecture §8.12).
// Obtains a short-lived grantId (60s) that authorises sensitive operations
// such as revealing or regenerating the recovery code.

import { apiFetch } from "./client";
import { signInWithGoogle } from "./google";

export interface ReauthGrant {
  grantId: string;
  expiresAt: string;
}

/**
 * Completes the full reauth ceremony:
 *  1. POST /api/v1/reauth/challenge → nonce
 *  2. Trigger a fresh Google sign-in popup → idToken
 *  3. POST /api/v1/reauth/verify with {nonce, idToken} → grantId
 *
 * The returned grantId is valid for 60 seconds and must be passed as the
 * X-Reauth-Grant header on privileged endpoints.
 */
export async function requestReauthGrant(): Promise<ReauthGrant> {
  const { nonce } = await apiFetch<{ nonce: string }>("/api/v1/reauth/challenge", {
    method: "POST",
  });

  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("VITE_GOOGLE_OAUTH_CLIENT_ID not set");
  const { idToken } = await signInWithGoogle({ clientId, nonce });

  const grant = await apiFetch<ReauthGrant>("/api/v1/reauth/verify", {
    method: "POST",
    body: JSON.stringify({ nonce, idToken }),
  });

  return grant;
}
