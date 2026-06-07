// Solo-to-family migration helper (architecture §8.7, Phase 7e).
//
// Reads all local Dexie records, re-encrypts each under the target family key,
// then calls migrateSolo to upload the batch to the server.
//
// The target family key is passed as a base64url string obtained from the
// acceptInvite response (the server provides a wrapped copy the new member
// can unwrap with their device key).
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
 * from Dexie, re-encrypts each under the target family key via the crypto worker
 * (using a dedicated RPC that bypasses the stored key), and uploads the batch.
 *
 * @param targetFamilyId  The family the user is joining.
 * @param targetFamilyKey The new family's key as raw bytes (provided by the
 *                        server wrapped in the user's device envelope,
 *                        unwrapped by caller before being passed here).
 */
export async function migrateSoloRecordsToFamily(
  targetFamilyId: string,
  targetFamilyKey: Uint8Array,
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

      const meta = {
        verByte: 1 as const,
        familyId: targetFamilyId,
        recordId,
        recordType,
        addedByUserId: userId,
        editedByUserId: userId,
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
        addedByUser: userId,
        editedByUser: userId,
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
