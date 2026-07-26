declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = GIS_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface GoogleCredential {
  idToken: string;
}

export async function signInWithGoogle(opts: {
  clientId: string;
  nonce?: string;
}): Promise<GoogleCredential> {
  await loadGisScript();
  return new Promise((resolve, reject) => {
    window.google.accounts.id.initialize({
      client_id: opts.clientId,
      nonce: opts.nonce,
      callback: (resp: { credential: string }) => resolve({ idToken: resp.credential }),
      auto_select: false,
      ux_mode: "popup",
    });
    window.google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        reject(new Error("Google sign-in dismissed"));
      }
    });
  });
}

/**
 * Renders Google's official "Sign in with Google" button into `container` and
 * invokes `onCredential` with the ID token when the user completes sign-in.
 *
 * This is used instead of `id.prompt()` (One Tap) for the primary sign-in entry
 * point, because One Tap is unreliable on mobile browsers (FedCM requirements,
 * third-party-cookie restrictions, and One Tap cooldown routinely suppress it,
 * which surfaces as "Sign-in failed"). The rendered button works consistently
 * across desktop and mobile. The onboarding UI overlays this (invisibly) on top
 * of the styled app button so the tap is captured by Google's element.
 */
export async function renderGoogleSignInButton(opts: {
  container: HTMLElement;
  clientId: string;
  width: number;
  onCredential: (idToken: string) => void;
}): Promise<void> {
  await loadGisScript();
  window.google.accounts.id.initialize({
    client_id: opts.clientId,
    callback: (resp: { credential: string }) => opts.onCredential(resp.credential),
    auto_select: false,
    ux_mode: "popup",
  });
  window.google.accounts.id.renderButton(opts.container, {
    type: "standard",
    theme: "filled_blue",
    size: "large",
    text: "continue_with",
    shape: "pill",
    logo_alignment: "center",
    width: opts.width,
  });
}
