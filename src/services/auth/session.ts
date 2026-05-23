import { create } from "zustand";
import { apiFetch } from "./client";
import { signInWithGoogle } from "./google";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AuthDevice {
  id: string;
  label: string;
}

interface AuthState {
  user: AuthUser | null;
  device: AuthDevice | null;
  isSignedIn: boolean;
  isSigningIn: boolean;
  error: string | null;
  needsFamilyInit: boolean;
  /** True when the sign-in response indicates this is a new device that must
   *  wait for an existing device to POST a familyKey envelope.
   *  While true, the app should show /devices/waiting. */
  awaitingEnvelope: boolean;
  /** Ephemeral device public key stashed after sign-in; consumed by onboarding init step.
   *  The private key is persisted inside the crypto worker and never exposed here. */
  pendingDevicePubKey: Uint8Array | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  clearPendingKeypair: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  device: null,
  isSignedIn: false,
  isSigningIn: false,
  error: null,
  needsFamilyInit: false,
  awaitingEnvelope: false,
  pendingDevicePubKey: null,

  signIn: async () => {
    set({ isSigningIn: true, error: null });
    try {
      const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) throw new Error("VITE_GOOGLE_OAUTH_CLIENT_ID not set");
      const { idToken } = await signInWithGoogle({ clientId });

      // Dynamic import keeps the Web Worker bundle out of the initial chunk.
      // The worker is only materialised on sign-in, matching the existing pattern
      // used by CryptoDemoPage (which also dynamic-imports worker-client).
      const { cryptoWorker } = await import("../crypto/worker-client");

      // Generate device keypair — X25519 ephemeral keys for this device.
      // Private key is persisted inside the worker; only the public key is returned.
      const devicePubKey = await cryptoWorker.generateAndPersistDeviceKey();
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
        needsFamilyInit: resp.needsFamilyInit ?? false,
        awaitingEnvelope: resp.awaitingEnvelope ?? false,
        pendingDevicePubKey: devicePubKey,
      });
    } catch (e: unknown) {
      set({ isSigningIn: false, error: e instanceof Error ? e.message : "sign-in failed" });
    }
  },

  signOut: async () => {
    try {
      await apiFetch("/api/v1/auth/signout", { method: "POST" });
    } catch {}
    set({
      user: null,
      device: null,
      isSignedIn: false,
      error: null,
      needsFamilyInit: false,
      awaitingEnvelope: false,
      pendingDevicePubKey: null,
    });
  },

  refreshMe: async () => {
    try {
      const me = await apiFetch<{ user: AuthUser; device: AuthDevice }>("/api/v1/me");
      set({ user: me.user, device: me.device, isSignedIn: true });
    } catch {
      set({ user: null, device: null, isSignedIn: false });
    }
  },

  clearPendingKeypair: () => {
    set({ pendingDevicePubKey: null });
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
