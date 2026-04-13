import { db } from '../db/database';

export async function checkDatabaseIntegrity(): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.all([
      db.accounts.limit(1).toArray(),
      db.categories.limit(1).toArray(),
      db.transactions.limit(1).toArray(),
      db.budgets.limit(1).toArray(),
      db.exchangeRates.limit(1).toArray(),
      db.settings.limit(1).toArray(),
      db.backups.limit(1).toArray(),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown database error' };
  }
}
