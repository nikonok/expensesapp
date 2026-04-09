interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

let _canInstall = false;
const _listeners = new Set<(v: boolean) => void>();

export function onCanInstallChange(fn: (v: boolean) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function setCanInstall(v: boolean) {
  _canInstall = v;
  _listeners.forEach((fn) => fn(v));
}

export function getCanInstall() {
  return _canInstall;
}

let _registered = false;
export function registerSW() {
  if (_registered) return;
  _registered = true;
  // Service worker registration is handled by vite-plugin-pwa's injected registerSW.js.
  // This function only wires up the install prompt events.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    setCanInstall(true);
  });
  window.addEventListener('appinstalled', () => {
    setCanInstall(false);
    deferredPrompt = null;
  });
}

export async function triggerInstall() {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (outcome === 'accepted') setCanInstall(false);
}

export function dismissInstall() {
  setCanInstall(false);
}
