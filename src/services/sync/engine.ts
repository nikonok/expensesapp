// Sync engine — orchestrates encrypt → outbox → push → merge → pull.
// Architecture §6.2, §7.6, Phase 4e.
//
// Public API:
//   enqueuePush(record)  — encrypt + store in outbox + fire flushOutbox()
//   flushOutbox()        — batch-push up to 50 pending records, handle conflicts
//   pullSince(cursor)    — fetch + decrypt + write to local DB tables + update cursor
//   startLiveSync(familyId) — connect SSE, wire events, return disconnect fn

import { db } from "@/db/database";
import type { PendingUpload, SyncRecordType } from "@/db/models";
import { logger } from "@/services/log.service";
import { transactionSchema, accountSchema, categorySchema, budgetSchema } from "@/utils/validation";
import { pushRecords, pullRecords } from "./client";
import { getCursor, setCursor, encodeCursor } from "./cursor";
import { mergePayloads } from "./merge";
import type { RawRecord, PullResponse, ConflictRecord, PulledRecord } from "./types";
import { useSyncStore } from "@/stores/sync-store";
import { connectSSE } from "./sse";
import type { SSEEventType, SSEPayloadMap } from "./sse";
import { apiFetch, type ApiError } from "@/services/auth/client";

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
    addedByUserId: record.addedByUserId,
    editedByUserId: record.editedByUserId,
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
    // Skip rows previously marked terminal (e.g. quota-exceeded). They stay in
    // the outbox so the UI can surface a banner but never get re-sent.
    const batch = (await db.pendingUploads.limit(PUSH_BATCH_SIZE * 2).toArray())
      .filter((p) => !p.terminal)
      .slice(0, PUSH_BATCH_SIZE);
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
      // B8 — treat HTTP 413 as a terminal quota error. Mark every record in
      // the batch as terminal so we stop retrying them, and surface a
      // quota-exceeded banner via the sync store.
      const status = (err as ApiError | undefined)?.status;
      if (status === 413) {
        await db.transaction("rw", db.pendingUploads, async () => {
          for (const item of batch) {
            if (item.id !== undefined) {
              await db.pendingUploads.update(item.id, {
                terminal: true,
                lastFailedAt: new Date().toISOString(),
              });
            }
          }
        });
        useSyncStore.getState().setLastError("quota-exceeded");
        logger.error("sync push 413 quota-exceeded; marked terminal", {
          count: batch.length,
        });
        return;
      }

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

    // Advance the pull cursor to the max familySeq among accepted records.
    // This prevents the next pullSince from redundantly re-fetching records
    // that the client just pushed.
    if (response.accepted.length > 0) {
      const maxSeq = response.accepted.reduce(
        (max, a) => (a.familySeq > max ? a.familySeq : max),
        response.accepted[0].familySeq,
      );
      const familyId = batch[0].familyId;
      await setCursor(familyId, encodeCursor(maxSeq));
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
  const addedByUserId = local.addedByUserId ?? "";
  const editedByUserId = local.editedByUserId ?? "";

  // B8 — invalid-parentVersion path: the backend returns an empty currentBlob
  // (with currentVersion=0 and no map) when a brand-new record arrived with a
  // non-zero parentVersion, or when a per-record quota check rejected the row.
  // There's nothing to decrypt + merge — just re-enqueue the existing local
  // ciphertext with parentVersion=0 so the next push treats it as a new record.
  if (conflict.currentBlob === "") {
    const requeued: PendingUpload = {
      recordId: local.recordId,
      recordType: local.recordType,
      blob: local.blob,
      updatedAtMap: local.updatedAtMap,
      deletedAt: local.deletedAt,
      parentVersion: 0,
      plaintextByteCount: local.plaintextByteCount,
      attempts: 0,
      lastFailedAt: null,
      familyId: local.familyId,
      addedByUserId,
      editedByUserId,
    };
    await db.pendingUploads.add(requeued);
    logger.info("sync conflict: invalid-parentVersion → re-enqueued at v0", {
      recordId: local.recordId,
    });
    return;
  }

  const { cryptoWorker } = await import("@/services/crypto/worker-client");

  // Build meta for local blob decryption using the originally-stored editor IDs.
  // Falling back to empty strings preserves the previous behaviour for outbox
  // rows persisted before the schema bump.
  const localMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    addedByUserId,
    editedByUserId,
    updatedAtMap: local.updatedAtMap,
    deletedAt: local.deletedAt ?? "",
  };

  const serverMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    addedByUserId,
    editedByUserId,
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

  // LWW merge. Pass editor IDs for tie-breaking (engine §7.6).
  const { mergedPayload, mergedMap } = mergePayloads(
    localPayload,
    serverPayload,
    local.updatedAtMap,
    conflict.currentUpdatedAtMap,
    editedByUserId,
    "",
  );

  // Re-encrypt with merged map.
  const mergedPt = new TextEncoder().encode(JSON.stringify(mergedPayload));
  const mergedMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    addedByUserId,
    editedByUserId,
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
    addedByUserId,
    editedByUserId,
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

      await writeDecryptedRecord(pulled.recordType, payload, pulled);
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

/**
 * B8 — tombstone propagation. When the pulled record carries a non-empty
 * `deletedAt`, the payload represents a soft-deleted row. For accounts and
 * categories we keep the local row (Dexie soft-delete: `isTrashed = true`)
 * so the trash views still work. For transactions / budgets / settings we
 * hard-delete the local row by id.
 */
export async function writeDecryptedRecord(
  recordType: string,
  payload: Record<string, unknown>,
  meta?: Pick<PulledRecord, "deletedAt" | "recordId">,
): Promise<void> {
  const isTombstone = !!(meta && meta.deletedAt && meta.deletedAt !== "");

  switch (recordType) {
    case "transaction": {
      if (isTombstone) {
        const localId = (payload as { id?: number }).id;
        if (typeof localId === "number") {
          await db.transactions.delete(localId);
        }
        return;
      }
      const result = transactionSchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid transaction payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await db.transactions.put(payload as Parameters<typeof db.transactions.put>[0]);
      break;
    }
    case "account": {
      if (isTombstone) {
        const localId = (payload as { id?: number }).id;
        if (typeof localId === "number") {
          // Soft-delete: keep the row so the trash view still works.
          await db.accounts.update(localId, { isTrashed: true });
        }
        return;
      }
      const result = accountSchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid account payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await db.accounts.put(payload as Parameters<typeof db.accounts.put>[0]);
      break;
    }
    case "category": {
      if (isTombstone) {
        const localId = (payload as { id?: number }).id;
        if (typeof localId === "number") {
          // Soft-delete: keep the row so the trash view still works.
          await db.categories.update(localId, { isTrashed: true });
        }
        return;
      }
      const result = categorySchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid category payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await db.categories.put(payload as Parameters<typeof db.categories.put>[0]);
      break;
    }
    case "budget": {
      if (isTombstone) {
        const localId = (payload as { id?: number }).id;
        if (typeof localId === "number") {
          await db.budgets.delete(localId);
        }
        return;
      }
      const result = budgetSchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid budget payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await db.budgets.put(payload as Parameters<typeof db.budgets.put>[0]);
      break;
    }
    case "settings":
      if (isTombstone) {
        const key = (payload as { key?: string }).key;
        if (typeof key === "string") {
          await db.settings.delete(key);
        }
        return;
      }
      // Settings payload: { key: string; value: unknown }
      await db.settings.put(payload as Parameters<typeof db.settings.put>[0]);
      break;
    default:
      logger.warn("pullSince: unknown recordType " + recordType);
  }
}

// ── startLiveSync ─────────────────────────────────────────────────────────────

/** Minimum interval between SSE-triggered pulls (ms). */
const PULL_DEBOUNCE_MS = 500;

/**
 * Connects SSE, wires event handlers, and returns a disconnect function.
 * - `record.changed` → debounced pullSince (max 1 pull per 500ms).
 * - `device.joined`  → updates useDeviceJoinStore so the UI can react and asks
 *                      the user for an explicit Approve / Reject decision. The
 *                      previous "silent approve after 500 ms" path was removed
 *                      (B5a) — a malicious server can no longer auto-trigger
 *                      a familyKey wrap to an attacker-controlled pubkey.
 * - `device.activated` → unwraps + persists familyKey via crypto worker, then
 *                        triggers a full pull so the new device is caught up.
 * - `you.removed`    → clears local Dexie data + signs out.
 */
export function startLiveSync(familyId: string): () => void {
  let pullTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPullAt = 0;

  function schedulePull() {
    if (pullTimer !== null) {
      clearTimeout(pullTimer);
    }
    const now = Date.now();
    const elapsed = now - lastPullAt;
    const delay = Math.max(0, PULL_DEBOUNCE_MS - elapsed);
    pullTimer = setTimeout(async () => {
      pullTimer = null;
      lastPullAt = Date.now();
      try {
        const cursor = await getCursor(familyId);
        await pullSince(familyId, cursor);
      } catch (err) {
        logger.warn("startLiveSync.pull.failed", err instanceof Error ? err : undefined);
      }
    }, delay);
  }

  const handle = connectSSE({
    onOpen: () => {
      logger.info("liveSync.connected", { familyId });
    },
    onError: () => {
      logger.warn("liveSync.sse.error");
    },
    onEvent: <T extends SSEEventType>(type: T, payload: SSEPayloadMap[T]) => {
      switch (type) {
        case "record.changed": {
          schedulePull();
          break;
        }
        case "device.joined": {
          const p = payload as SSEPayloadMap["device.joined"];
          // B5a: surface the pending device to the user via the join store
          // and wait for an explicit Approve / Reject decision. No auto-wrap.
          (async () => {
            let fingerprint: string | null = null;
            if (p.pubKey) {
              try {
                const { cryptoWorker } = await import("@/services/crypto/worker-client");
                fingerprint = await cryptoWorker.fingerprintPublicKey(p.pubKey);
              } catch (err) {
                logger.warn(
                  "liveSync.device.joined.fingerprint",
                  err instanceof Error ? err : undefined,
                );
              }
            }
            try {
              const { useDeviceJoinStore } = await import("@/stores/device-join-store");
              useDeviceJoinStore.getState().setPendingDeviceJoin({
                deviceId: p.deviceId,
                label: p.label,
                pubKey: p.pubKey ?? null,
                fingerprint,
                userAgent: p.userAgent ?? null,
                createdAt: p.createdAt ?? null,
              });
            } catch (err) {
              logger.warn("liveSync.device.joined.store", err instanceof Error ? err : undefined);
            }
          })();
          break;
        }
        case "device.activated": {
          const p = payload as SSEPayloadMap["device.activated"];
          (async () => {
            try {
              const { cryptoWorker } = await import("@/services/crypto/worker-client");
              await cryptoWorker.unwrapAndPersistFamilyKey(p.envelope);
              logger.info("liveSync.familyKey.persisted");
              // Signal that this device is no longer waiting for its envelope.
              // DeviceJoinWaiting watches this flag and navigates away when cleared.
              const { useAuthStore } = await import("@/services/auth/session");
              useAuthStore.getState().clearAwaitingEnvelope();
              // Trigger full pull now that we have the key.
              const cursor = await getCursor(familyId);
              await pullSince(familyId, cursor);
            } catch (err) {
              logger.error(
                "liveSync.device.activated.failed",
                err instanceof Error ? err : undefined,
              );
            }
          })();
          break;
        }
        case "you.removed": {
          (async () => {
            try {
              // Clear all local Dexie domain data first.
              await Promise.all([
                db.transactions.clear(),
                db.accounts.clear(),
                db.categories.clear(),
                db.budgets.clear(),
                db.settings.clear(),
                db.pendingUploads.clear(),
                db.syncCursors.clear(),
              ]);
              // Crypto key material lives in the worker-owned DB now (B5d).
              try {
                const { cryptoWorker } = await import("@/services/crypto/worker-client");
                await cryptoWorker.clearAllStoredKeys();
              } catch (err) {
                logger.warn(
                  "liveSync.you.removed.clearKeys.failed",
                  err instanceof Error ? err : undefined,
                );
              }
              // Sign out via auth store.
              const { useAuthStore } = await import("@/services/auth/session");
              await useAuthStore.getState().signOut();
              // Navigate to onboarding — full reload clears in-memory state.
              window.location.assign("/onboarding");
            } catch (err) {
              logger.error("liveSync.you.removed.failed", err instanceof Error ? err : undefined);
            }
          })();
          break;
        }
        case "sync.barrier": {
          const p = payload as SSEPayloadMap["sync.barrier"];
          (async () => {
            try {
              // Replace the local cursor with the barrier cursor, then trigger
              // a full pull from scratch so the DB reflects the restored snapshot.
              await setCursor(familyId, p.cursor);
              await pullSince(familyId, undefined);
              logger.info("liveSync.sync.barrier.applied", { cursor: p.cursor });
            } catch (err) {
              logger.error("liveSync.sync.barrier.failed", err instanceof Error ? err : undefined);
            }
          })();
          break;
        }
        case "notification.dismiss": {
          const p = payload as SSEPayloadMap["notification.dismiss"];
          (async () => {
            try {
              if ("serviceWorker" in navigator) {
                const registration = await navigator.serviceWorker.ready;
                const notifications = await registration.getNotifications({
                  tag: p.notificationId,
                });
                for (const n of notifications) {
                  n.close();
                }
                logger.info("liveSync.notification.dismiss", {
                  notificationId: p.notificationId,
                  closed: notifications.length,
                });
              }
            } catch (err) {
              logger.warn(
                "liveSync.notification.dismiss.failed",
                err instanceof Error ? err : undefined,
              );
            }
          })();
          break;
        }
        default:
          break;
      }
    },
  });

  return () => {
    if (pullTimer !== null) clearTimeout(pullTimer);
    handle.disconnect();
  };
}

// ── approveDevice / rejectDevice (B5a, B8) ────────────────────────────────────
//
// Replaces the old `silentlyApproveDevice` 500 ms auto-wrap path. The server
// no longer dictates when a familyKey envelope is produced for a joining
// device — the user must press Approve in the banner.
//
// approveDevice: called from the UI when the user clicks "Approve". Wraps the
// stored familyKey for the joining device's pubkey (in-worker), then POSTs
// the envelope. The raw familyKey never crosses the postMessage boundary.
//
// rejectDevice: called from the UI when the user clicks "Reject". Records the
// rejection locally (audit log) and asks the backend to revoke the joining
// device session via `POST /v1/me/devices/{id}/revoke`.
//
// B8: the `GET /v1/me/devices/{id}` fallback used to fetch a missing pubkey
// has been dropped. The backend `device.joined` SSE payload always carries
// `pubKey` (see backend/internal/auth/handlers.go:299-304), so there is no
// scenario where the banner reaches Approve without a pubkey already in hand.

/**
 * Approve a pending device join (B5a). Called only after explicit user
 * confirmation in `DeviceJoinedBanner`. Wraps the stored familyKey for the
 * device's pubkey and POSTs the envelope.
 */
export async function approveDevice(deviceId: string, pubKeyB64u: string | null): Promise<void> {
  if (!pubKeyB64u) {
    // Should never happen: the SSE `device.joined` payload always includes
    // pubKey, and the banner is the only caller. Bail loudly rather than
    // attempting a network round-trip that no backend endpoint serves.
    throw new Error("approveDevice: missing pubKey in pending join");
  }

  const { cryptoWorker } = await import("@/services/crypto/worker-client");
  const envelopeB64u = await cryptoWorker.wrapStoredFamilyKeyForDevice(pubKeyB64u);

  await apiFetch(`/api/v1/family/devices/${deviceId}/envelope`, {
    method: "POST",
    body: JSON.stringify({ envelope: envelopeB64u }),
  });

  logger.info("liveSync.device.approved", { deviceId });
}

/**
 * Reject a pending device join (B5a). Records a local audit log entry and
 * revokes the joining device server-side.
 */
export async function rejectDevice(deviceId: string): Promise<void> {
  logger.warn("liveSync.device.rejected", { deviceId });
  await apiFetch(`/api/v1/me/devices/${deviceId}/revoke`, { method: "POST" });
  logger.info("liveSync.device.rejected.posted", { deviceId });
}

// ── Re-export cursor read for callers that only need the current cursor ────────
export { getCursor };
