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
