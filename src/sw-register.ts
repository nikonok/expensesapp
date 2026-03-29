import { Workbox } from 'workbox-window';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

let _canInstall = false;
const _listeners: ((v: boolean) => void)[] = [];
export function onCanInstallChange(fn: (v: boolean) => void) {
  _listeners.push(fn);
}
function setCanInstall(v: boolean) {
  _canInstall = v;
  _listeners.forEach((fn) => fn(v));
}
export function getCanInstall() {
  return _canInstall;
}

export function registerSW() {
  if ('serviceWorker' in navigator) {
    const wb = new Workbox('/sw.js');
    wb.register().catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
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
  if (outcome === 'accepted') setCanInstall(false);
  deferredPrompt = null;
}

export function dismissInstall() {
  setCanInstall(false);
}
