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
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  device: null,
  isSignedIn: false,
  isSigningIn: false,
  error: null,

  signIn: async () => {
    set({ isSigningIn: true, error: null });
    try {
      const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) throw new Error("VITE_GOOGLE_OAUTH_CLIENT_ID not set");
      const { idToken } = await signInWithGoogle({ clientId });
      const deviceLabel = inferDeviceLabel();
      const userAgent = navigator.userAgent;
      // Phase 1 placeholder: real X25519 pubkey lands in Phase 2.
      const resp = await apiFetch<{ user: AuthUser; device: AuthDevice }>("/api/v1/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken, devicePubKey: null, deviceLabel, userAgent }),
      });
      set({ user: resp.user, device: resp.device, isSignedIn: true, isSigningIn: false });
    } catch (e: unknown) {
      set({ isSigningIn: false, error: e instanceof Error ? e.message : "sign-in failed" });
    }
  },

  signOut: async () => {
    try {
      await apiFetch("/api/v1/auth/signout", { method: "POST" });
    } catch {}
    set({ user: null, device: null, isSignedIn: false, error: null });
  },

  refreshMe: async () => {
    try {
      const me = await apiFetch<{ user: AuthUser; device: AuthDevice }>("/api/v1/me");
      set({ user: me.user, device: me.device, isSignedIn: true });
    } catch {
      set({ user: null, device: null, isSignedIn: false });
    }
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
