import { db } from "@/db/database";
import { logger } from "./log.service";

class ResetService {
  async resetApp(): Promise<void> {
    // 1. Unsubscribe push. Must run BEFORE settings are wiped — it needs the
    // pushSubscriptionId setting to DELETE the right row on the backend.
    try {
      const setting = await db.settings.get("pushSubscriptionId");
      const subscriptionId = typeof setting?.value === "string" ? setting.value : null;
      if (subscriptionId) {
        const { disablePush } = await import("@/services/push/subscribe");
        await disablePush(subscriptionId);
      }
    } catch (err) {
      logger.warn(
        "reset.push.unsubscribe.failed",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // 2. Sign out — clears the session cookie server-side and the local auth state.
    try {
      const { useAuthStore } = await import("@/services/auth/session");
      await useAuthStore.getState().signOut();
    } catch (err) {
      logger.warn("reset.signout.failed", err instanceof Error ? err : new Error(String(err)));
    }

    // 3. Clear worker-owned key material (B5d). Done outside the Dexie transaction
    // because the keys live in a separate IndexedDB (`expenses-app-keys`).
    try {
      const { cryptoWorker } = await import("@/services/crypto/worker-client");
      await cryptoWorker.clearAllStoredKeys();
    } catch (err) {
      logger.warn("reset.worker.keys.failed", err instanceof Error ? err : new Error(String(err)));
    }

    // 4. Clear all local Dexie state, including the legacy `cipherKeys` table
    // (accessed via `db.table(...)` since the main-thread type map no longer
    // declares it — see database.ts v6 comment).
    try {
      await db.transaction(
        "rw",
        [
          db.accounts,
          db.categories,
          db.transactions,
          db.budgets,
          db.exchangeRates,
          db.settings,
          db.backups,
          db.logs,
          db.pendingUploads,
          db.syncCursors,
          db.table("cipherKeys"),
        ],
        async () => {
          await db.accounts.clear();
          await db.categories.clear();
          await db.transactions.clear();
          await db.budgets.clear();
          await db.exchangeRates.clear();
          await db.settings.clear();
          await db.backups.clear();
          await db.logs.clear();
          await db.pendingUploads.clear();
          await db.syncCursors.clear();
          await db.table("cipherKeys").clear();
        },
      );
    } catch (err) {
      logger.error("reset.dexie.clear.failed", err instanceof Error ? err : new Error(String(err)));
    }

    // 5. Unregister the service worker and clear Cache Storage.
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
    } catch (err) {
      logger.warn(
        "reset.sw.unregister.failed",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (err) {
      logger.warn("reset.caches.clear.failed", err instanceof Error ? err : new Error(String(err)));
    }

    window.dispatchEvent(new CustomEvent("backup-restored"));
  }
}

export const resetService = new ResetService();
export const resetApp = resetService.resetApp.bind(resetService);
