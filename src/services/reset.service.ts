import { db } from '@/db/database';

class ResetService {
  async resetApp(): Promise<void> {
    await db.transaction(
      'rw',
      [db.accounts, db.categories, db.transactions, db.budgets,
       db.exchangeRates, db.settings, db.backups, db.logs],
      async () => {
        await db.accounts.clear();
        await db.categories.clear();
        await db.transactions.clear();
        await db.budgets.clear();
        await db.exchangeRates.clear();
        await db.settings.clear();
        await db.backups.clear();
        await db.logs.clear();
      },
    );
    window.dispatchEvent(new CustomEvent('backup-restored'));
  }
}

export const resetService = new ResetService();
export const resetApp = resetService.resetApp.bind(resetService);
