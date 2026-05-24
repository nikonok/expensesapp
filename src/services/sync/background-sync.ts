// Background sync helpers — Periodic Background Sync (Chrome/Android PWA)
// and foreground catch-up pull on visibilitychange (iOS PWA fallback).
// Architecture §1.1, §9.3 — Phase 12.

import { logger } from "@/services/log.service";
import { getLocalFamilyId } from "@/services/family/active-family";
import { pullSince, getCursor } from "./engine";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATCH_UP_TAG = "catch-up-sync";
const CATCH_UP_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Minimum interval between catch-up pulls triggered by foreground/BC events (ms). */
const CATCH_UP_DEBOUNCE_MS = 30_000; // 30 seconds

// ── Shared state ──────────────────────────────────────────────────────────────

/** Timestamp of the last successfully-triggered catch-up pull (foreground path). */
let lastCatchUpAt = 0;

/** True while a catch-up pull is in progress (prevents re-entrant pulls). */
let catchUpInProgress = false;

// ── iOS detection ─────────────────────────────────────────────────────────────

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ── PeriodicSyncManager type (not in lib.dom yet) ─────────────────────────────

type PeriodicSyncManager = {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
};

function getPeriodicSync(reg: ServiceWorkerRegistration): PeriodicSyncManager | null {
  if (!("periodicSync" in reg)) return null;
  return (reg as ServiceWorkerRegistration & { periodicSync: PeriodicSyncManager }).periodicSync;
}

// ── Core catch-up logic ───────────────────────────────────────────────────────

/**
 * Runs a catch-up pull if one isn't already in flight and the debounce window
 * has elapsed. Called by both visibilitychange and BroadcastChannel handlers.
 */
async function runCatchUp(): Promise<void> {
  if (catchUpInProgress) return;

  const now = Date.now();
  if (now - lastCatchUpAt < CATCH_UP_DEBOUNCE_MS) return;

  catchUpInProgress = true;
  try {
    const familyId = await getLocalFamilyId();
    if (!familyId) {
      lastCatchUpAt = Date.now();
      return;
    }

    const cursor = await getCursor(familyId);
    await pullSince(familyId, cursor);
    lastCatchUpAt = Date.now();
    logger.info("bgSync.catchUp.done");
  } catch (err) {
    logger.warn("bgSync.catchUp.failed", err instanceof Error ? err : undefined);
  } finally {
    catchUpInProgress = false;
  }
}

// ── Cleanup refs ──────────────────────────────────────────────────────────────

let visibilityCleanup: (() => void) | null = null;
let broadcastCleanup: (() => void) | null = null;

/** Resets module-level state. Exported for test isolation only. */
export function _resetForTesting(): void {
  if (!import.meta.env.TEST) return;
  lastCatchUpAt = 0;
  catchUpInProgress = false;
  visibilityCleanup = null;
  broadcastCleanup = null;
}

// ── registerPeriodicSync ──────────────────────────────────────────────────────

/**
 * Registers the "catch-up-sync" Periodic Background Sync tag with ~4h interval.
 * No-op on iOS (PBS API unsupported) or when the SW API is unavailable.
 * Errors are swallowed — PBS permission may be denied by the browser.
 */
export async function registerCatchUpPeriodicSync(): Promise<void> {
  if (isIOS()) return;
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ps = getPeriodicSync(reg);
    if (!ps) return; // Not supported (Firefox, old Chrome, Safari)
    await ps.register(CATCH_UP_TAG, { minInterval: CATCH_UP_INTERVAL_MS });
    logger.info("bgSync.periodicSync.registered");
  } catch {
    // Browser denied (low engagement score, permissions policy, etc.)
  }
}

/**
 * Unregisters the "catch-up-sync" tag. Called on sign-out.
 * Errors are swallowed.
 */
export async function unregisterCatchUpPeriodicSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ps = getPeriodicSync(reg);
    if (!ps) return;
    await ps.unregister(CATCH_UP_TAG);
  } catch {
    // noop
  }
}

// ── setupForegroundCatchUp ────────────────────────────────────────────────────

/**
 * Attaches a visibilitychange listener that triggers a catch-up pull whenever
 * the page becomes visible (app foregrounded). Debounced to 30s. Idempotent —
 * a second call tears down the previous listener before attaching a new one.
 *
 * This is the primary catch-up path on iOS where Periodic Background Sync is
 * not available.
 */
export function setupForegroundCatchUp(): void {
  // Tear down any existing listener.
  if (visibilityCleanup) {
    visibilityCleanup();
    visibilityCleanup = null;
  }

  const handler = () => {
    if (document.visibilityState === "visible") {
      runCatchUp().catch((err) => {
        logger.warn("bgSync.foreground.error", err instanceof Error ? err : undefined);
      });
    }
  };

  document.addEventListener("visibilitychange", handler);
  visibilityCleanup = () => document.removeEventListener("visibilitychange", handler);
  logger.info("bgSync.foregroundCatchUp.setup");
}

// ── setupBroadcastChannelListener ────────────────────────────────────────────

/**
 * Listens on a BroadcastChannel for "sync-tick" messages emitted by the
 * service worker's periodicsync handler. When received, triggers a catch-up
 * pull. Idempotent — a second call tears down the previous channel first.
 *
 * The SW cannot decrypt records (no familyKey in SW scope), so instead of
 * pulling data itself, it posts a "sync-tick" message to any open client and
 * the main thread handles the actual pull.
 */
export function setupBroadcastChannelListener(): void {
  // Tear down any existing channel.
  if (broadcastCleanup) {
    broadcastCleanup();
    broadcastCleanup = null;
  }

  if (typeof BroadcastChannel === "undefined") return;

  const channel = new BroadcastChannel("catch-up-sync");

  const handler = (event: MessageEvent) => {
    if (event.data?.type === "sync-tick") {
      runCatchUp().catch((err) => {
        logger.warn("bgSync.broadcastChannel.error", err instanceof Error ? err : undefined);
      });
    }
  };

  channel.addEventListener("message", handler);
  broadcastCleanup = () => {
    channel.removeEventListener("message", handler);
    channel.close();
  };
  logger.info("bgSync.broadcastChannel.setup");
}

// ── teardown ──────────────────────────────────────────────────────────────────

/**
 * Removes all foreground catch-up listeners and closes the BroadcastChannel.
 * Called on sign-out.
 */
export function teardownBackgroundSync(): void {
  if (visibilityCleanup) {
    visibilityCleanup();
    visibilityCleanup = null;
  }
  if (broadcastCleanup) {
    broadcastCleanup();
    broadcastCleanup = null;
  }
  unregisterCatchUpPeriodicSync().catch(() => {});
  logger.info("bgSync.teardown");
}

// ── isPeriodicsyncSupported ───────────────────────────────────────────────────

/**
 * Returns true if the Periodic Background Sync API is available in this
 * browser. Used by the Settings → Sync section to show support status.
 */
export async function isPeriodicsyncSupported(): Promise<boolean> {
  if (isIOS()) return false;
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return "periodicSync" in reg;
  } catch {
    return false;
  }
}

/**
 * Returns true if the "catch-up-sync" tag is currently registered.
 */
export async function isCatchUpSyncRegistered(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ps = getPeriodicSync(reg);
    if (!ps) return false;
    // The PeriodicSyncManager.getTags() API returns registered tags.
    const tags = await (ps as PeriodicSyncManager & { getTags(): Promise<string[]> }).getTags();
    return tags.includes(CATCH_UP_TAG);
  } catch {
    return false;
  }
}
