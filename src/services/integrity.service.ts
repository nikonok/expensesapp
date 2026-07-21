import { db } from "../db/database";
import { logger } from "./log.service";

export type IntegrityFailureKind = "read" | "orphaned-transfer" | "orphaned-account-ref";

export interface IntegrityResult {
  ok: boolean;
  error?: string;
  /** Distinguishes which check failed, so callers can react differently
   *  (e.g. offer a different recovery action for a hard read failure vs. a
   *  semantic data-consistency issue). */
  failureKind?: IntegrityFailureKind;
}

/** Counts transfer groups (rows sharing a non-null `transferGroupId`) that
 *  don't have exactly 2 legs — i.e. a dangling OUT or IN half of a transfer. */
async function countOrphanedTransferLegs(): Promise<number> {
  const groupIds = await db.transactions.orderBy("transferGroupId").uniqueKeys();
  let orphaned = 0;
  for (const groupId of groupIds) {
    if (groupId == null) continue;
    const legCount = await db.transactions
      .where("transferGroupId")
      .equals(groupId as string)
      .count();
    if (legCount !== 2) orphaned++;
  }
  return orphaned;
}

/** Counts transactions whose `accountId` does not reference an existing account. */
async function countOrphanedAccountRefs(): Promise<number> {
  const accountIds = new Set(await db.accounts.toCollection().primaryKeys());
  let orphaned = 0;
  await db.transactions.each((tx) => {
    if (!accountIds.has(tx.accountId)) orphaned++;
  });
  return orphaned;
}

export async function checkDatabaseIntegrity(): Promise<IntegrityResult> {
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
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown database error",
      failureKind: "read",
    };
  }

  try {
    const orphanedTransferCount = await countOrphanedTransferLegs();
    if (orphanedTransferCount > 0) {
      logger.error("db.integrity.orphaned_transfer", { count: orphanedTransferCount });
      return {
        ok: false,
        error: `${orphanedTransferCount} orphaned transfer leg(s) detected`,
        failureKind: "orphaned-transfer",
      };
    }

    const orphanedAccountRefCount = await countOrphanedAccountRefs();
    if (orphanedAccountRefCount > 0) {
      logger.error("db.integrity.orphaned_account_ref", { count: orphanedAccountRefCount });
      return {
        ok: false,
        error: `${orphanedAccountRefCount} transaction(s) reference a missing account`,
        failureKind: "orphaned-account-ref",
      };
    }
  } catch (err) {
    // Semantic checks are best-effort on top of the hard read check above —
    // don't block startup if they themselves fail to run.
    logger.warn(
      "db.integrity.semantic_check.failed",
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  logger.info("db.integrity.ok");
  return { ok: true };
}
