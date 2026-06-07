import { db } from "@/db/database";

class ResetService {
  async resetApp(): Promise<void> {
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
      },
    );

    // Clear worker-owned key material (B5d). Done outside the Dexie transaction
    // because the keys live in a separate IndexedDB (`expenses-app-keys`).
    try {
      const { cryptoWorker } = await import("@/services/crypto/worker-client");
      await cryptoWorker.clearAllStoredKeys();
    } catch {
      // Worker failures during reset are non-fatal — the Dexie clear has
      // already removed all domain data.
    }

    window.dispatchEvent(new CustomEvent("backup-restored"));
  }
}

export const resetService = new ResetService();
export const resetApp = resetService.resetApp.bind(resetService);
