import { create } from "zustand";
import { apiFetch, type ApiError } from "./client";
import { signInWithGoogle } from "./google";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isRoot: boolean;
  deleteAfter?: string | null;
}

export interface AuthDevice {
  id: string;
  label: string;
}

export interface AuthFamily {
  id: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  device: AuthDevice | null;
  isSignedIn: boolean;
  isSigningIn: boolean;
  /** True once the initial session-restore call (`refreshMe()` on app boot)
   *  has settled (success or failure). Signed-in-dependent logic (sync
   *  connect, admin route, startup redirects) should wait on this so a cold
   *  start doesn't flicker/misroute before we know the real session state. */
  sessionResolved: boolean;
  error: string | null;
  /** HTTP status of the last sign-in failure, if any — lets callers branch
   *  on e.g. 403 (allowlist rejection) vs. a generic network/server error. */
  errorStatus: number | null;
  needsFamilyInit: boolean;
  /** True when the sign-in response indicates this is a new device that must
   *  wait for an existing device to POST a familyKey envelope.
   *  While true, the app should show /devices/waiting. */
  awaitingEnvelope: boolean;
  /** The caller's active family, if any — populated from `/v1/me` so a page
   *  reload (or any other point after the sign-in response) can bootstrap
   *  sync without a family already present in the local sync-cursor table
   *  (e.g. a brand-new/pending device that has never pulled yet). Null when
   *  not an active member of any family. */
  family: AuthFamily | null;
  /** Ephemeral device public key stashed after sign-in; consumed by onboarding init step.
   *  The private key is persisted inside the crypto worker and never exposed here. */
  pendingDevicePubKey: Uint8Array | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  clearPendingKeypair: () => void;
  clearAwaitingEnvelope: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  device: null,
  isSignedIn: false,
  isSigningIn: false,
  sessionResolved: false,
  error: null,
  errorStatus: null,
  needsFamilyInit: false,
  awaitingEnvelope: false,
  family: null,
  pendingDevicePubKey: null,

  signIn: async () => {
    set({ isSigningIn: true, error: null, errorStatus: null });
    try {
      const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) throw new Error("VITE_GOOGLE_OAUTH_CLIENT_ID not set");
      const { idToken } = await signInWithGoogle({ clientId });

      // Dynamic import keeps the Web Worker bundle out of the initial chunk.
      // The worker is only materialised on sign-in, matching the existing pattern
      // used by CryptoDemoPage (which also dynamic-imports worker-client).
      const { cryptoWorker } = await import("../crypto/worker-client");

      // Reuse the device keypair already cached in this worker instance if one
      // exists (e.g. sign-out immediately followed by sign-in in the same tab).
      // Regenerating unconditionally here would strand any envelope approval
      // that's already in flight for the previous public key. This only
      // covers the lifetime of the current worker instance — a full page
      // reload always starts a fresh worker with no cached key, so a new
      // keypair is generated in that case, same as before.
      const existingPubKey = await cryptoWorker.getDevicePublicKey();
      const devicePubKey = existingPubKey ?? (await cryptoWorker.generateAndPersistDeviceKey());
      const devicePubKeyB64 = btoa(String.fromCharCode(...devicePubKey))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const deviceLabel = inferDeviceLabel();
      const userAgent = navigator.userAgent;
      const resp = await apiFetch<{
        user: AuthUser;
        device: AuthDevice;
        needsFamilyInit?: boolean;
        awaitingEnvelope?: boolean;
      }>("/api/v1/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken, devicePubKey: devicePubKeyB64, deviceLabel, userAgent }),
      });

      set({
        user: resp.user,
        device: resp.device,
        isSignedIn: true,
        isSigningIn: false,
        sessionResolved: true,
        needsFamilyInit: resp.needsFamilyInit ?? false,
        awaitingEnvelope: resp.awaitingEnvelope ?? false,
        pendingDevicePubKey: devicePubKey,
      });
    } catch (e: unknown) {
      set({
        isSigningIn: false,
        error: e instanceof Error ? e.message : "sign-in failed",
        errorStatus: typeof (e as ApiError)?.status === "number" ? (e as ApiError).status : null,
      });
    }
  },

  signOut: async () => {
    // B8 — clear local auth state BEFORE the network call. The signout
    // endpoint itself sits behind the same session cookie; if it 401s (e.g.
    // the session was already revoked elsewhere), the global 401 interceptor
    // must not treat this as an unexpected sign-out — clearing first makes
    // this signOut() call idempotent and lets the interceptor's own
    // `isSignedIn` check see the (already false) post-sign-out state.
    set({
      user: null,
      device: null,
      isSignedIn: false,
      error: null,
      needsFamilyInit: false,
      awaitingEnvelope: false,
      family: null,
      pendingDevicePubKey: null,
    });
    try {
      await apiFetch("/api/v1/auth/signout", { method: "POST" });
    } catch {}
  },

  refreshMe: async () => {
    try {
      const me = await apiFetch<{
        user: AuthUser;
        device: AuthDevice;
        family?: AuthFamily | null;
        awaitingEnvelope?: boolean;
      }>("/api/v1/me");
      set({
        user: me.user,
        device: me.device,
        isSignedIn: true,
        awaitingEnvelope: me.awaitingEnvelope ?? false,
        family: me.family ?? null,
        sessionResolved: true,
      });
    } catch {
      set({
        user: null,
        device: null,
        isSignedIn: false,
        awaitingEnvelope: false,
        family: null,
        sessionResolved: true,
      });
    }
  },

  clearPendingKeypair: () => {
    set({ pendingDevicePubKey: null });
  },

  clearAwaitingEnvelope: () => {
    set({ awaitingEnvelope: false });
  },
}));

function inferDeviceLabel(): string {
  const ua = navigator.userAgent;
  // Best-effort short label per BR §3.10: "<UA-derived name> (YYYY-MM-DD)".
  let name = "Browser";
  if (/Android/i.test(ua)) name = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) name = "iOS";
  else if (/Macintosh/i.test(ua)) name = "Mac";
  else if (/Windows/i.test(ua)) name = "Windows";
  else if (/Linux/i.test(ua)) name = "Linux";
  return `${name} (${new Date().toISOString().slice(0, 10)})`;
}
