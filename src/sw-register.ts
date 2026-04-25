import { registerSW as registerSWVite } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

let _canInstall = false;
const _installListeners = new Set<(v: boolean) => void>();

export function onCanInstallChange(fn: (v: boolean) => void): () => void {
  _installListeners.add(fn);
  return () => { _installListeners.delete(fn); };
}

function setCanInstall(v: boolean) {
  _canInstall = v;
  _installListeners.forEach((fn) => fn(v));
}

export function getCanInstall() {
  return _canInstall;
}

// ── SW update state ───────────────────────────────────────────────────────────

let _updateAvailable = false;
let _doUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
const _updateListeners = new Set<(v: boolean) => void>();

export function onUpdateAvailableChange(fn: (v: boolean) => void): () => void {
  _updateListeners.add(fn);
  return () => { _updateListeners.delete(fn); };
}

function setUpdateAvailable(v: boolean) {
  _updateAvailable = v;
  _updateListeners.forEach((fn) => fn(v));
}

export function getUpdateAvailable() {
  return _updateAvailable;
}

export async function triggerUpdate() {
  if (_doUpdate) await _doUpdate(true);
}

export function dismissUpdate() {
  setUpdateAvailable(false);
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

  const updateSW = registerSWVite({
    onNeedRefresh() {
      _doUpdate = updateSW;
      setUpdateAvailable(true);
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
