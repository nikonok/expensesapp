// Solo-to-family migration helper (architecture §8.7, Phase 7e).
//
// Reads all local Dexie records, re-encrypts each under the target family key
// inside the crypto worker, then calls migrateSolo to upload the batch.
//
// B5c: the raw familyKey no longer crosses postMessage. The target key arrives
// as a sealed envelope wrapped for this device's pubkey during acceptInvite;
// the caller passes that envelope here and the crypto worker unwraps it
// internally for the re-encrypt + (optionally) persists it as the new stored
// familyKey once the upload succeeds.
//
// Wire-contract notes (see WORK_PLAN.md brief B2):
//   - `migrationId` is required and is the backend idempotency key. We persist
//     it keyed by (sourceFamilyId, targetFamilyId) so retries reuse it.
//   - `recordId` is a UUID string, resolved via the SAME canonical
//     `recordMappings` table the live sync engine uses (`record-mapping.ts`)
//     — Dexie's int auto-increment ids are NOT suitable for cross-device
//     sync. Subsequent edits to the same Dexie row (via push-helpers.ts,
//     post-migration) reuse the same UUID — required for downstream merge
//     logic and for the server to recognise them as the same record.
//   - `updatedAtMap` is stringified at the client → backend boundary inside
//     `migrateSolo` (the wire field is `string`, not object).

import { db } from "@/db/database";
import { getLocalFamilyId } from "./active-family";
import { migrateSolo, type SoloRecord } from "./client";
import { logger } from "@/services/log.service";
import { useAuthStore } from "@/services/auth/session";
import { getOrCreateMappingForPush, newUUID } from "@/services/sync/record-mapping";
import type { RecordType } from "@/services/sync/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── Migration idempotency key (persisted in db.settings) ────────────────────

/** db.settings key for the per-(source,target) migration idempotency id. */
function migrationIdSettingKey(sourceFamilyId: string, targetFamilyId: string): string {
  return `family.migration.id:${sourceFamilyId}:${targetFamilyId}`;
}

/**
 * Read the persisted migrationId for this (source,target) pair, or mint and
 * persist a new one. The same id is reused on every retry — that is exactly
 * what makes the backend `MigrateSolo` call idempotent.
 */
async function getOrCreateMigrationId(
  sourceFamilyId: string,
  targetFamilyId: string,
): Promise<string> {
  const key = migrationIdSettingKey(sourceFamilyId, targetFamilyId);
  const existing = await db.settings.get(key);
  if (existing && typeof existing.value === "string" && existing.value.length > 0) {
    return existing.value;
  }
  const fresh = newUUID();
  await db.settings.put({ key, value: fresh });
  return fresh;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Gathers all local domain records (transactions, accounts, categories, budgets)
 * from Dexie, asks the crypto worker to re-encrypt each under the target family
 * key, and uploads the batch.
 *
 * The raw target familyKey stays inside the worker. The caller passes the
 * sealed envelope wrapped for this device's pubkey (returned by acceptInvite)
 * and the worker unwraps it on demand. On success the worker also persists
 * the new key as the device's active familyKey (replacing the solo key).
 *
 * @param targetFamilyId  The family the user is joining.
 * @param targetEnvelope  Sealed-box envelope (80 bytes) of the new family's
 *                        key, wrapped for this device's pubkey. Obtained
 *                        client-side from the acceptInvite response.
 */
export async function migrateSoloRecordsToFamily(
  targetFamilyId: string,
  targetEnvelope: Uint8Array,
): Promise<void> {
  const { cryptoWorker } = await import("@/services/crypto/worker-client");

  // Current user id is required by the backend handler (`addedByUser` /
  // `editedByUser`). If we are not signed in we cannot proceed — surface a
  // descriptive error so callers can show a real message rather than the
  // backend's 400.
  const userId = useAuthStore.getState().user?.id ?? "";
  if (!userId) {
    throw new Error("migrate-solo: no signed-in user; refusing to upload");
  }

  // Resolve the source family id. May be null on a brand-new device that has
  // never synced (no rows in syncCursors) — in that case the source is "solo"
  // by convention. The id is part of the idempotency key, NOT sent on the
  // wire (the backend reads the source from the caller's active family).
  const sourceFamilyId = (await getLocalFamilyId()) ?? "solo";

  // Same-family safety: never try to migrate INTO our own family. The
  // backend now rejects this with 409 source-same-as-target, but we
  // short-circuit client-side to avoid a wasted round-trip.
  if (sourceFamilyId === targetFamilyId) {
    throw new Error("migrate-solo: source family is the same as target family");
  }

  const migrationId = await getOrCreateMigrationId(sourceFamilyId, targetFamilyId);

  const now = new Date().toISOString();

  // Collect each record type, mint stable UUIDs, and build the worker batch.
  const [transactions, accounts, categories, budgets] = await Promise.all([
    db.transactions.toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
    db.budgets.toArray(),
  ]);

  type WorkerBatchEntry = {
    recordType: string;
    recordId: string;
    plaintext: Uint8Array;
    meta: {
      verByte: 1;
      familyId: string;
      recordId: string;
      recordType: string;
      addedByUserId: string;
      editedByUserId: string;
      updatedAtMap: Record<string, string>;
      deletedAt: string;
    };
  };

  const workerBatch: WorkerBatchEntry[] = [];
  // Side-channel info we need after re-encryption to assemble SoloRecord[].
  const sidecar: Array<{
    isTrashed: boolean;
    updatedAtMap: Record<string, string>;
    addedByUserId: string;
  }> = [];

  async function collect(
    records: Record<string, unknown>[],
    recordType: RecordType,
    getLocalId: (r: Record<string, unknown>) => string,
  ) {
    for (const record of records) {
      const localId = getLocalId(record);
      if (!localId) {
        logger.warn("migrate: skipping record with no id", { recordType });
        continue;
      }
      // Resolve via the SAME canonical mapping the live sync engine uses. If
      // this row never had a mapping, this device mints one now with
      // `userId` as creator. If it already had one (e.g. this row
      // previously round-tripped through live sync), its uuid AND original
      // creator are reused unchanged — migration must never reassign
      // authorship of an existing record.
      const mapping = await getOrCreateMappingForPush(recordType, localId, userId);
      const recordId = mapping.uuid;
      const addedByUserId = mapping.creatorUserId;
      const plaintext = new TextEncoder().encode(JSON.stringify(record));
      const updatedAtMap: Record<string, string> = { _all: now };
      const isTrashed = Boolean(record.isTrashed);
      workerBatch.push({
        recordType,
        recordId,
        plaintext,
        meta: {
          verByte: 1,
          familyId: targetFamilyId,
          recordId,
          recordType,
          addedByUserId,
          editedByUserId: userId,
          updatedAtMap,
          deletedAt: isTrashed ? now : "",
        },
      });
      sidecar.push({ isTrashed, updatedAtMap, addedByUserId });
    }
  }

  await collect(transactions as unknown as Record<string, unknown>[], "transaction", (r) =>
    String(r.id ?? ""),
  );
  await collect(accounts as unknown as Record<string, unknown>[], "account", (r) =>
    String(r.id ?? ""),
  );
  await collect(categories as unknown as Record<string, unknown>[], "category", (r) =>
    String(r.id ?? ""),
  );
  await collect(budgets as unknown as Record<string, unknown>[], "budget", (r) =>
    String(r.id ?? ""),
  );

  // Single worker call — unwraps the target key in-worker, encrypts every
  // record, and (since we expect to swap to the target family on success)
  // persists the new key. The raw key never crosses postMessage.
  const encrypted = await cryptoWorker.migrateSoloRecords(targetEnvelope, true, workerBatch);

  const reEncrypted: SoloRecord[] = encrypted.map((enc, idx) => ({
    recordType: enc.recordType,
    recordId: enc.recordId,
    blob: toBase64Url(enc.blob),
    updatedAtMap: sidecar[idx].updatedAtMap,
    addedByUser: sidecar[idx].addedByUserId,
    editedByUser: userId,
    deletedAt: sidecar[idx].isTrashed ? now : undefined,
    plaintextByteCount: enc.plaintextByteCount,
  }));

  logger.info("migrate: uploading solo records", {
    count: reEncrypted.length,
    targetFamilyId,
    migrationId,
  });

  // Always POST — even with zero records the call is meaningful (it commits
  // the migration id on the server). The previous "skip when empty" branch
  // meant a retry could never re-hit the idempotent path.
  await migrateSolo(migrationId, targetFamilyId, reEncrypted);

  logger.info("migrate: complete");
}
