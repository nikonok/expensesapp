/// <reference lib="webworker" />

import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// ── Precaching (VitePWA injects the manifest at build time) ──────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ── Runtime caching ──────────────────────────────────────────────────────────

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\//i,
  new CacheFirst({
    cacheName: "google-fonts-webfonts",
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 365 * 24 * 60 * 60,
        maxEntries: 30,
      }),
    ],
  }),
);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\//i,
  new StaleWhileRevalidate({
    cacheName: "google-fonts-stylesheets",
  }),
);

registerRoute(
  /^https:\/\/open\.er-api\.com\//i,
  new NetworkFirst({
    cacheName: "exchange-rates",
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 24 * 60 * 60,
        maxEntries: 10,
      }),
    ],
  }),
);

// ── Lifecycle ────────────────────────────────────────────────────────────────
// Skip waiting only on explicit SKIP_WAITING message (sent by vite-plugin-pwa
// when the user acknowledges the update). Without this guard, autoUpdate would
// silently reload the page the moment the user returns from a background switch.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Raw IDB helpers (no Dexie in SW context) ─────────────────────────────────

const DB_NAME = "expenses-app-db";
const SETTINGS_STORE = "settings";

function readSettingsFromIDB(keys: string[]): Promise<Map<string, unknown>> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve(new Map());
      return;
    }

    request.onblocked = () => resolve(new Map());
    request.onerror = () => resolve(new Map());

    // If DB doesn't exist yet, abort to avoid creating an empty DB at v1
    // which would conflict with Dexie's v3 schema on next app open.
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort();
      } catch {
        /* noop */
      }
      resolve(new Map());
    };

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.close();
        resolve(new Map());
        return;
      }

      const results = new Map<string, unknown>();
      let pending = keys.length;

      if (pending === 0) {
        db.close();
        resolve(results);
        return;
      }

      const tx = db.transaction(SETTINGS_STORE, "readonly");
      tx.onerror = () => {
        db.close();
        resolve(results);
      };

      for (const key of keys) {
        const getReq = tx.objectStore(SETTINGS_STORE).get(key);
        getReq.onsuccess = () => {
          if (getReq.result != null) {
            results.set(key, getReq.result.value);
          }
          if (--pending === 0) {
            db.close();
            resolve(results);
          }
        };
        getReq.onerror = () => {
          if (--pending === 0) {
            db.close();
            resolve(results);
          }
        };
      }
    };
  });
}

function writeSettingToIDB(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve();
      return;
    }

    request.onerror = () => resolve();
    request.onblocked = () => resolve();
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort();
      } catch {
        /* noop */
      }
      resolve();
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(SETTINGS_STORE, "readwrite");
      tx.objectStore(SETTINGS_STORE).put({ key, value });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
  });
}

// ── Notification logic ────────────────────────────────────────────────────────

function todayDateString(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function shouldNotify(notificationTime: string, lastNotifiedDate: string | null): boolean {
  if (lastNotifiedDate === todayDateString()) return false;

  const [h, m] = notificationTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return false;

  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  if (now < target) return false; // Too early — don't fire before the scheduled time
  const diffMs = now.getTime() - target.getTime();
  return diffMs <= 2 * 60 * 60 * 1000;
}

// ── Periodic Background Sync handler ─────────────────────────────────────────

interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string;
}

// BroadcastChannel used to signal open clients to run a catch-up pull.
// The SW cannot decrypt records (no familyKey in SW scope), so it delegates
// the actual pull to whatever client tab is alive.
const CATCH_UP_CHANNEL = "catch-up-sync";

self.addEventListener("periodicsync", (event: Event) => {
  const syncEvent = event as PeriodicSyncEvent;

  // ── catch-up-sync: notify the main thread to run a pull ──────────────────
  if (syncEvent.tag === "catch-up-sync") {
    syncEvent.waitUntil(
      (async () => {
        // Only notify if at least one client window is open and visible.
        // If no clients are alive the next foreground open will catch up via
        // the visibilitychange handler, so doing nothing here is correct.
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: false,
        });
        if (clients.length === 0) return;

        if (typeof BroadcastChannel !== "undefined") {
          const ch = new BroadcastChannel(CATCH_UP_CHANNEL);
          ch.postMessage({ type: "sync-tick" });
          ch.close();
        } else {
          // Fallback: post directly to each client.
          for (const client of clients) {
            client.postMessage({ type: "sync-tick" });
          }
        }
      })(),
    );
    return;
  }

  if (syncEvent.tag !== "daily-reminder") return;

  syncEvent.waitUntil(
    (async () => {
      const settings = await readSettingsFromIDB([
        "notificationEnabled",
        "notificationTime",
        "lastNotifiedDate",
      ]);

      if (settings.get("notificationEnabled") !== true) return;

      const time = (settings.get("notificationTime") as string) || "20:00";
      const lastDate = (settings.get("lastNotifiedDate") as string) ?? null;

      if (!shouldNotify(time, lastDate)) return;

      await self.registration.showNotification("Expenses", {
        body: "Time to log your expenses!",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "daily-reminder",
      });

      await writeSettingToIDB("lastNotifiedDate", todayDateString());
    })(),
  );
});

// ── Push event: display notification from server payload ─────────────────────

self.addEventListener("push", (event) => {
  let title = "Expenses";
  let body = "";
  let tag: string | undefined;
  let url: string | undefined;

  if (event.data) {
    try {
      const payload = event.data.json() as {
        title?: string;
        body?: string;
        tag?: string;
        url?: string;
      };
      if (payload.title) title = payload.title;
      if (payload.body) body = payload.body;
      if (payload.tag) tag = payload.tag;
      if (payload.url) url = payload.url;
    } catch {
      body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag,
      data: { url },
    }),
  );
});

// ── Notification click: focus app or open it ──────────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl: string = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) {
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
