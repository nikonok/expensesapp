import { db } from "../db/database";
import { logger } from "./log.service";

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
      db.logs.limit(1).toArray(),
    ]);
    logger.warn("db.integrity.ok");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown database error" };
  }
}
