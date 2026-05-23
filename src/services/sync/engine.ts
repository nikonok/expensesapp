// Sync engine — orchestrates encrypt → outbox → push → merge → pull.
// Architecture §6.2, §7.6, Phase 4e.
//
// Public API:
//   enqueuePush(record)  — encrypt + store in outbox + fire flushOutbox()
//   flushOutbox()        — batch-push up to 50 pending records, handle conflicts
//   pullSince(cursor)    — fetch + decrypt + write to local DB tables + update cursor

import { db } from "@/db/database";
import type { PendingUpload, SyncRecordType } from "@/db/models";
import { logger } from "@/services/log.service";
import { pushRecords, pullRecords } from "./client";
import { getCursor, setCursor } from "./cursor";
import { mergePayloads } from "./merge";
import type { RawRecord, PullResponse, ConflictRecord } from "./types";
import { useSyncStore } from "@/stores/sync-store";

const PUSH_BATCH_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** base64url encode with no padding. */
function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** base64url decode (handles padded and unpadded). */
function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildRecordMeta(record: RawRecord, updatedAtMap: Record<string, string>) {
  return {
    verByte: 1,
    familyId: record.familyId,
    recordId: record.recordId,
    recordType: record.recordType,
    addedByUserId: record.addedByUserId,
    editedByUserId: record.editedByUserId,
    updatedAtMap,
    deletedAt: record.deletedAt ?? "",
  };
}

// ── enqueuePush ───────────────────────────────────────────────────────────────

/**
 * Encrypts a raw record, stores the envelope in the pendingUploads outbox,
 * then immediately fires flushOutbox() if the browser is online.
 */
export async function enqueuePush(record: RawRecord): Promise<void> {
  const { cryptoWorker } = await import("@/services/crypto/worker-client");

  const plaintext = new TextEncoder().encode(JSON.stringify(record.payload));
  const meta = buildRecordMeta(record, record.updatedAtMap);

  const { blob, plaintextByteCount } = await cryptoWorker.encryptRecordWithStoredKey(
    plaintext,
    meta,
  );

  const pending: PendingUpload = {
    recordId: record.recordId,
    recordType: record.recordType as SyncRecordType,
    blob: toBase64Url(blob),
    updatedAtMap: record.updatedAtMap,
    deletedAt: record.deletedAt,
    parentVersion: record.parentVersion,
    plaintextByteCount,
    attempts: 0,
    lastFailedAt: null,
    familyId: record.familyId,
  };

  await db.pendingUploads.add(pending);

  if (navigator.onLine) {
    // Fire-and-forget — caller doesn't need to await the flush.
    flushOutbox().catch((err) => {
      logger.warn("flushOutbox failed after enqueue", err instanceof Error ? err : undefined);
    });
  }
}

// ── flushOutbox ───────────────────────────────────────────────────────────────

/** Serialise concurrent flush calls: only one runs at a time. */
let flushInProgress = false;

/**
 * Reads up to 50 records from pendingUploads, pushes them to the server,
 * then on success deletes them; on conflict merges + re-enqueues; on hard
 * 4xx errors increments attempts and marks lastFailedAt.
 */
export async function flushOutbox(): Promise<void> {
  if (flushInProgress) return;
  flushInProgress = true;
  useSyncStore.getState().setIsSyncing(true);

  try {
    const batch = await db.pendingUploads.limit(PUSH_BATCH_SIZE).toArray();
    if (batch.length === 0) return;

    let response;
    try {
      response = await pushRecords({
        records: batch.map((p) => ({
          recordId: p.recordId,
          recordType: p.recordType,
          blob: p.blob,
          updatedAtMap: p.updatedAtMap,
          deletedAt: p.deletedAt,
          parentVersion: p.parentVersion,
          plaintextByteCount: p.plaintextByteCount,
        })),
      });
    } catch (err) {
      // Network-level or 5xx error — mark all batch items as failed.
      const now = new Date().toISOString();
      await db.transaction("rw", db.pendingUploads, async () => {
        for (const item of batch) {
          if (item.id !== undefined) {
            await db.pendingUploads.update(item.id, {
              attempts: item.attempts + 1,
              lastFailedAt: now,
            });
          }
        }
      });
      useSyncStore.getState().setLastError(err instanceof Error ? err.message : String(err));
      logger.error("sync push failed", err instanceof Error ? err : undefined);
      return;
    }

    // Build lookup maps.
    const acceptedIds = new Set(response.accepted.map((a) => a.recordId));
    const conflictMap = new Map<string, ConflictRecord>(
      response.conflicts.map((c) => [c.recordId, c]),
    );

    await db.transaction("rw", db.pendingUploads, async () => {
      for (const item of batch) {
        if (acceptedIds.has(item.recordId)) {
          // Successfully pushed — remove from outbox.
          if (item.id !== undefined) {
            await db.pendingUploads.delete(item.id);
          }
        } else if (conflictMap.has(item.recordId)) {
          // Conflict — remove from outbox; the merge path will re-enqueue.
          if (item.id !== undefined) {
            await db.pendingUploads.delete(item.id);
          }
        } else {
          // Not in accepted or conflicts — treat as a hard failure.
          const now = new Date().toISOString();
          if (item.id !== undefined) {
            await db.pendingUploads.update(item.id, {
              attempts: item.attempts + 1,
              lastFailedAt: now,
            });
          }
        }
      }
    });

    // Handle conflicts: merge + re-enqueue outside the DB transaction above.
    const conflictItems = batch.filter((p) => conflictMap.has(p.recordId));
    for (const item of conflictItems) {
      const conflict = conflictMap.get(item.recordId)!;
      try {
        await resolveConflict(item, conflict);
      } catch (err) {
        logger.error(
          "conflict resolution failed for " + item.recordId,
          err instanceof Error ? err : undefined,
        );
      }
    }

    useSyncStore.getState().setLastSyncAt(new Date().toISOString());
    useSyncStore.getState().setLastError(null);
    logger.info("sync flush complete", {
      accepted: response.accepted.length,
      conflicts: response.conflicts.length,
    });
  } finally {
    flushInProgress = false;
    useSyncStore.getState().setIsSyncing(false);
  }
}

// ── Conflict resolution (§7.6) ────────────────────────────────────────────────

async function resolveConflict(local: PendingUpload, conflict: ConflictRecord): Promise<void> {
  const { cryptoWorker } = await import("@/services/crypto/worker-client");

  // Build meta for local blob decryption (we need a placeholder meta for local).
  const localMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    // We don't have the original editor IDs stored; use empty strings — they're
    // only used for tie-breaking, not for AAD verification of an existing blob.
    addedByUserId: "",
    editedByUserId: "",
    updatedAtMap: local.updatedAtMap,
    deletedAt: local.deletedAt ?? "",
  };

  const serverMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    addedByUserId: "",
    editedByUserId: "",
    updatedAtMap: conflict.currentUpdatedAtMap,
    deletedAt: "",
  };

  // Decrypt both blobs.
  const localPt = await cryptoWorker.decryptRecordWithStoredKey(
    fromBase64Url(local.blob),
    localMeta,
  );
  const serverPt = await cryptoWorker.decryptRecordWithStoredKey(
    fromBase64Url(conflict.currentBlob),
    serverMeta,
  );

  const localPayload = JSON.parse(new TextDecoder().decode(localPt)) as Record<string, unknown>;
  const serverPayload = JSON.parse(new TextDecoder().decode(serverPt)) as Record<string, unknown>;

  // LWW merge.
  const { mergedPayload, mergedMap } = mergePayloads(
    localPayload,
    serverPayload,
    local.updatedAtMap,
    conflict.currentUpdatedAtMap,
    "",
    "",
  );

  // Re-encrypt with merged map.
  const mergedPt = new TextEncoder().encode(JSON.stringify(mergedPayload));
  const mergedMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    addedByUserId: "",
    editedByUserId: "",
    updatedAtMap: mergedMap,
    deletedAt: local.deletedAt ?? "",
  };
  const { blob, plaintextByteCount } = await cryptoWorker.encryptRecordWithStoredKey(
    mergedPt,
    mergedMeta,
  );

  // Store back in outbox with updated parentVersion for re-push.
  const requeued: PendingUpload = {
    recordId: local.recordId,
    recordType: local.recordType,
    blob: toBase64Url(blob),
    updatedAtMap: mergedMap,
    deletedAt: local.deletedAt,
    parentVersion: conflict.currentVersion,
    plaintextByteCount,
    attempts: 0,
    lastFailedAt: null,
    familyId: local.familyId,
  };

  await db.pendingUploads.add(requeued);
}

// ── pullSince ─────────────────────────────────────────────────────────────────

/**
 * Fetches encrypted records from the server since the given cursor,
 * decrypts them, writes to the appropriate Dexie tables, and updates the cursor.
 */
export async function pullSince(
  familyId: string,
  cursor: string | undefined,
): Promise<PullResponse> {
  useSyncStore.getState().setIsSyncing(true);
  try {
    const response = await pullRecords({ since: cursor });
    const { cryptoWorker } = await import("@/services/crypto/worker-client");

    for (const pulled of response.records) {
      const meta = {
        verByte: 1 as const,
        familyId,
        recordId: pulled.recordId,
        recordType: pulled.recordType,
        addedByUserId: pulled.addedByUser,
        editedByUserId: pulled.editedByUser,
        updatedAtMap: pulled.updatedAtMap,
        deletedAt: pulled.deletedAt ?? "",
      };

      let decrypted: Uint8Array;
      try {
        decrypted = await cryptoWorker.decryptRecordWithStoredKey(fromBase64Url(pulled.blob), meta);
      } catch (err) {
        logger.warn(
          "failed to decrypt pulled record " + pulled.recordId,
          err instanceof Error ? err : undefined,
        );
        continue;
      }

      const payload = JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;

      await writeDecryptedRecord(pulled.recordType, payload);
    }

    // Advance the cursor.
    await setCursor(familyId, response.nextCursor);
    useSyncStore.getState().setLastSyncAt(new Date().toISOString());
    useSyncStore.getState().setLastError(null);

    return response;
  } catch (err) {
    useSyncStore.getState().setLastError(err instanceof Error ? err.message : String(err));
    logger.error("pullSince failed", err instanceof Error ? err : undefined);
    throw err;
  } finally {
    useSyncStore.getState().setIsSyncing(false);
  }
}

// ── Write decrypted record to Dexie ──────────────────────────────────────────

async function writeDecryptedRecord(
  recordType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (recordType) {
    case "transaction":
      await db.transactions.put(payload as Parameters<typeof db.transactions.put>[0]);
      break;
    case "account":
      await db.accounts.put(payload as Parameters<typeof db.accounts.put>[0]);
      break;
    case "category":
      await db.categories.put(payload as Parameters<typeof db.categories.put>[0]);
      break;
    case "budget":
      await db.budgets.put(payload as Parameters<typeof db.budgets.put>[0]);
      break;
    case "settings":
      // Settings payload: { key: string; value: unknown }
      await db.settings.put(payload as Parameters<typeof db.settings.put>[0]);
      break;
    default:
      logger.warn("pullSince: unknown recordType " + recordType);
  }
}

// ── Re-export cursor read for callers that only need the current cursor ────────
export { getCursor };
