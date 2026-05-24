// Web Push subscription helper — architecture §8.x, Phase 9g.
//
// Public API:
//   ensurePushSubscription() — request permission, subscribe, POST to backend
//   disablePush(subscriptionId) — unsubscribe locally + DELETE on backend

import { apiFetch } from "@/services/auth/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Backend-assigned subscription id returned by POST /v1/push/subscribe. */
  id: string;
}

export interface CreateSubscriptionResponse {
  id: string;
}

// ── VAPID key ─────────────────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Encodes an ArrayBuffer to a URL-safe base64 string (no padding). */
function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── ensurePushSubscription ────────────────────────────────────────────────────

/**
 * Requests Notification permission, subscribes via PushManager, and POSTs
 * the subscription keys to the backend.
 *
 * Returns the extracted keys on success, or null if permission was denied or
 * the environment does not support push.
 */
export async function ensurePushSubscription(): Promise<PushSubscriptionKeys | null> {
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn("ensurePushSubscription: VITE_VAPID_PUBLIC_KEY is not set");
    return null;
  }

  // Request permission if not already granted.
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return null;
  }

  // Wait for the active service worker.
  const registration = await navigator.serviceWorker.ready;

  // Subscribe (or retrieve an existing subscription).
  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  const rawKey = subscription.getKey("p256dh");
  const rawAuth = subscription.getKey("auth");

  if (!rawKey || !rawAuth) {
    return null;
  }

  const p256dh = toBase64Url(rawKey);
  const auth = toBase64Url(rawAuth);

  let backendId = "";
  // POST to backend — fire and forget errors are swallowed after logging.
  try {
    const resp = await apiFetch<CreateSubscriptionResponse>("/api/v1/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint, p256dh, auth }),
    });
    backendId = resp.id;
  } catch (err) {
    console.error("ensurePushSubscription: failed to register with backend", err);
    // Don't return null — the browser-side subscription succeeded.
  }

  const keys: PushSubscriptionKeys = {
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    id: backendId,
  };

  return keys;
}

// ── disablePush ───────────────────────────────────────────────────────────────

/**
 * Unsubscribes the current PushManager subscription locally and sends a
 * DELETE request to the backend for the given subscriptionId.
 */
export async function disablePush(subscriptionId: string): Promise<void> {
  // Unsubscribe locally.
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
    } catch (err) {
      console.warn("disablePush: local unsubscribe failed", err);
    }
  }

  // Tell the backend.
  await apiFetch(`/api/v1/push/subscribe/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
  });
}
