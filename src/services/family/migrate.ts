// Solo-to-family migration helper (architecture §8.7, Phase 7e).
//
// Reads all local Dexie records, re-encrypts each under the target family key,
// then calls migrateSolo to upload the batch to the server.
//
// The target family key is passed as a base64url string obtained from the
// acceptInvite response (the server provides a wrapped copy the new member
// can unwrap with their device key).

import { db } from "@/db/database";
import { migrateSolo, type SoloRecord } from "./client";
import { logger } from "@/services/log.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Gathers all local domain records (transactions, accounts, categories, budgets)
 * from Dexie, re-encrypts each under the target family key via the crypto worker
 * (using a dedicated RPC that bypasses the stored key), and uploads the batch.
 *
 * @param targetFamilyId  The family the user is joining.
 * @param targetFamilyKey The new family's key as base64url (provided by the server
 *                        wrapped in the user's device envelope, unwrapped by caller).
 */
export async function migrateSoloRecordsToFamily(
  targetFamilyId: string,
  targetFamilyKey: Uint8Array,
): Promise<void> {
  const { cryptoWorker } = await import("@/services/crypto/worker-client");

  const now = new Date().toISOString();
  const reEncrypted: SoloRecord[] = [];

  // Collect each record type and re-encrypt under the target family key.
  const [transactions, accounts, categories, budgets] = await Promise.all([
    db.transactions.toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
    db.budgets.toArray(),
  ]);

  async function processRecords(
    records: Record<string, unknown>[],
    recordType: string,
    getId: (r: Record<string, unknown>) => string,
  ) {
    for (const record of records) {
      const recordId = getId(record);
      if (!recordId) {
        logger.warn("migrate: skipping record with no id", { recordType });
        continue;
      }

      const plaintext = new TextEncoder().encode(JSON.stringify(record));
      const updatedAtMap: Record<string, string> = { _all: now };

      const meta = {
        verByte: 1 as const,
        familyId: targetFamilyId,
        recordId,
        recordType,
        addedByUserId: "",
        editedByUserId: "",
        updatedAtMap,
        deletedAt: (record.isTrashed ? now : "") as string,
      };

      // Use the worker RPC that encrypts under an explicitly provided key
      // rather than the stored key.
      const { blob, plaintextByteCount } = await cryptoWorker.encryptRecord(
        plaintext,
        targetFamilyKey,
        meta,
      );

      reEncrypted.push({
        recordType,
        recordId,
        blob: toBase64Url(blob),
        updatedAtMap,
        deletedAt: record.isTrashed ? now : undefined,
        plaintextByteCount,
      });
    }
  }

  await processRecords(transactions as unknown as Record<string, unknown>[], "transaction", (r) =>
    String(r.id ?? ""),
  );
  await processRecords(accounts as unknown as Record<string, unknown>[], "account", (r) =>
    String(r.id ?? ""),
  );
  await processRecords(categories as unknown as Record<string, unknown>[], "category", (r) =>
    String(r.id ?? ""),
  );
  await processRecords(budgets as unknown as Record<string, unknown>[], "budget", (r) =>
    String(r.id ?? ""),
  );

  logger.info("migrate: uploading solo records", { count: reEncrypted.length, targetFamilyId });

  if (reEncrypted.length > 0) {
    await migrateSolo(targetFamilyId, reEncrypted);
  }

  logger.info("migrate: complete");
}
