import { registerSW as registerSWVite } from 'virtual:pwa-register';

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

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    setCanInstall(true);
  });
  window.addEventListener('appinstalled', () => {
    setCanInstall(false);
    deferredPrompt = null;
  });

  // Register SW via vite-plugin-pwa. With registerType "prompt" no auto-reload
  // happens on controllerchange — the update applies silently on next app launch.
  registerSWVite({
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('sw-update-available'));
    },
    onOfflineReady() {},
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

// ── Periodic Background Sync ──────────────────────────────────────────────────

const SYNC_TAG = 'daily-reminder';
const SYNC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

type PeriodicSyncManager = {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
};

function getPeriodicSync(reg: ServiceWorkerRegistration): PeriodicSyncManager | null {
  if (!('periodicSync' in reg)) return null;
  return (reg as ServiceWorkerRegistration & { periodicSync: PeriodicSyncManager }).periodicSync;
}

export async function registerPeriodicSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ps = getPeriodicSync(reg);
    if (!ps) return; // Not supported (Firefox, Safari, old Chrome)
    await ps.register(SYNC_TAG, { minInterval: SYNC_MIN_INTERVAL_MS });
  } catch {
    // Browser denied (low engagement score, permissions policy, etc.)
  }
}

export async function unregisterPeriodicSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ps = getPeriodicSync(reg);
    if (!ps) return;
    await ps.unregister(SYNC_TAG);
  } catch {
    // noop
  }
}
