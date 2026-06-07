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
//   - `recordId` is a UUID string. Dexie's int auto-increment ids are NOT
//     suitable for cross-device sync, so we lazily mint a UUID per local row
//     and persist the mapping. Subsequent edits to the same Dexie row reuse
//     the same UUID — required for downstream merge logic.
//   - `updatedAtMap` is stringified at the client → backend boundary inside
//     `migrateSolo` (the wire field is `string`, not object).

import { db } from "@/db/database";
import { getLocalFamilyId } from "./active-family";
import { migrateSolo, type SoloRecord } from "./client";
import { logger } from "@/services/log.service";
import { useAuthStore } from "@/services/auth/session";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Generate a UUID. Prefers the platform `crypto.randomUUID()` (UUIDv4) which
 * is universally available in browsers + Node 19+. The brief notes that the
 * backend does not enforce UUIDv7 for record ids, so v4 is acceptable.
 */
function newUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: 16 random bytes formatted as v4 UUID. Used only in test envs
  // where `crypto.randomUUID` is not exposed.
  const rnd = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(rnd);
  } else {
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 256);
  }
  rnd[6] = (rnd[6] & 0x0f) | 0x40;
  rnd[8] = (rnd[8] & 0x3f) | 0x80;
  const hex = Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

// ── Stable id mapping (persisted in db.settings) ─────────────────────────────

/** db.settings key for the per-(source,target) migration idempotency id. */
function migrationIdSettingKey(sourceFamilyId: string, targetFamilyId: string): string {
  return `family.migration.id:${sourceFamilyId}:${targetFamilyId}`;
}

/**
 * db.settings key for the per-record UUID mapping. One row per record type;
 * value is a `Record<localId, recordUUID>` so we can reuse UUIDs on retry +
 * subsequent edits.
 */
function recordIdMapSettingKey(recordType: string): string {
  return `family.migration.recordIds:${recordType}`;
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

/**
 * Get a stable UUID for `(recordType, localId)`. If we have seen this
 * `(recordType, localId)` pair before we return the previously minted UUID;
 * otherwise we mint a new one and persist it. The mapping survives across
 * retries and across later edits of the same record so subsequent sync
 * operations (and the merge logic on the server) see a stable identity.
 */
async function getOrCreateRecordId(recordType: string, localId: string): Promise<string> {
  const key = recordIdMapSettingKey(recordType);
  const row = await db.settings.get(key);
  const map: Record<string, string> =
    row && row.value && typeof row.value === "object" ? (row.value as Record<string, string>) : {};
  const existing = map[localId];
  if (existing) return existing;
  const fresh = newUUID();
  map[localId] = fresh;
  await db.settings.put({ key, value: map });
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
  }> = [];

  async function collect(
    records: Record<string, unknown>[],
    recordType: string,
    getLocalId: (r: Record<string, unknown>) => string,
  ) {
    for (const record of records) {
      const localId = getLocalId(record);
      if (!localId) {
        logger.warn("migrate: skipping record with no id", { recordType });
        continue;
      }
      const recordId = await getOrCreateRecordId(recordType, localId);
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
          addedByUserId: userId,
          editedByUserId: userId,
          updatedAtMap,
          deletedAt: isTrashed ? now : "",
        },
      });
      sidecar.push({ isTrashed, updatedAtMap });
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
    addedByUser: userId,
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
