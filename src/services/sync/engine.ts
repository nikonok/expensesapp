// Sync engine — orchestrates encrypt → outbox → push → merge → pull.
// Architecture §6.2, §7.6, Phase 4e.
//
// Public API:
//   enqueuePush(record)  — encrypt + store in outbox + fire flushOutbox()
//   flushOutbox()        — batch-push up to 50 pending records, handle conflicts
//   pullSince(cursor)    — fetch + decrypt + write to local DB tables + update cursor
//   startLiveSync(familyId) — connect SSE, wire events, return disconnect fn

import { db } from "@/db/database";
import type { PendingUpload, SyncRecordType, Transaction } from "@/db/models";
import { logger } from "@/services/log.service";
import { transactionSchema, accountSchema, categorySchema, budgetSchema } from "@/utils/validation";
import { getBalanceDelta } from "@/services/balance.service";
import { pushRecords, pullRecords } from "./client";
import { getCursor, setCursor, encodeCursor, decodeCursor } from "./cursor";
import { mergePayloads } from "./merge";
import { getMappingByUuid, updateLastServerVersion, upsertMappingFromPull } from "./record-mapping";
import { SYNCED_SETTING_KEYS } from "./push-helpers";
import type {
  RawRecord,
  PullResponse,
  PushResponse,
  ConflictRecord,
  PulledRecord,
  RecordType,
} from "./types";
import { useSyncStore } from "@/stores/sync-store";
import { connectSSE } from "./sse";
import type { SSEEventType, SSEPayloadMap } from "./sse";
import { apiFetch, type ApiError } from "@/services/auth/client";
import { setLocalFamilyId } from "@/services/family/active-family";

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
 *
 * Coalescing: rapid successive edits to the same logical record (same
 * `recordId`) would otherwise pile up N outbox rows for one record. If a
 * non-terminal row for this `recordId` already exists, it is overwritten in
 * place with the new ciphertext/parentVersion instead of adding a second row
 * — the newest edit always supersedes the queued one. Terminal rows (e.g.
 * quota-exceeded) are left alone; a fresh row is added alongside them so the
 * new edit isn't silently dropped by a stuck-terminal predecessor.
 */
export async function enqueuePush(record: RawRecord): Promise<void> {
  const { cryptoWorker } = await import("@/services/crypto/worker-client");

  const plaintext = new TextEncoder().encode(JSON.stringify(record.payload));
  const meta = buildRecordMeta(record, record.updatedAtMap);

  const { blob, plaintextByteCount } = await cryptoWorker.encryptRecordWithStoredKey(
    plaintext,
    meta,
  );

  const pendingFields: Omit<PendingUpload, "id"> = {
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

  await db.transaction("rw", db.pendingUploads, async () => {
    const existing = await db.pendingUploads
      .where("recordId")
      .equals(record.recordId)
      .filter((p) => !p.terminal && p.recordType === record.recordType)
      .first();
    if (existing && existing.id !== undefined) {
      await db.pendingUploads.update(existing.id, pendingFields);
    } else {
      await db.pendingUploads.add(pendingFields as PendingUpload);
    }
  });

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
/** Set when enqueuePush/another caller asks for a flush while one is already
 *  running — re-run flushOutbox once the in-flight one finishes so a write
 *  that arrived mid-flush is never silently dropped. */
let pendingFlushRequested = false;

/** Exponential backoff for retrying a flush that left non-terminal rows
 *  behind after a transient (network/5xx) failure. Capped at ~5 minutes. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 5 * 60 * 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearScheduledRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(attempts: number): void {
  clearScheduledRetry();
  const exponent = Math.max(0, attempts - 1);
  const delayMs = Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
  const timer = setTimeout(() => {
    retryTimer = null;
    flushOutbox().catch((err) => {
      logger.warn("flushOutbox.retry.failed", err instanceof Error ? err : undefined);
    });
  }, delayMs);
  // Node's Timeout supports unref() (avoids keeping the test process alive);
  // browsers return a plain number, where this is a no-op.
  (timer as unknown as { unref?: () => void }).unref?.();
  retryTimer = timer;
}

type FlushBatchOutcome = "empty" | "success" | "terminal" | "error";

/**
 * Pushes ONE batch (up to PUSH_BATCH_SIZE non-terminal rows) and processes
 * the response. Terminal rows (quota-exceeded / deterministic 400) are
 * excluded by the query itself (`.filter()` runs during the Dexie cursor
 * walk, before `.limit()` — see B-retry-3c) so they can never starve the
 * window out from under genuinely retryable rows.
 */
async function flushBatchOnce(): Promise<{
  outcome: FlushBatchOutcome;
  batchLength: number;
  maxAttempts: number;
}> {
  const batch = await db.pendingUploads
    .filter((p) => !p.terminal)
    .limit(PUSH_BATCH_SIZE)
    .toArray();
  if (batch.length === 0) {
    return { outcome: "empty", batchLength: 0, maxAttempts: 0 };
  }

  let response: PushResponse;
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
    // quota-exceeded banner via the sync store. `retryTerminalUploads()`
    // (wired to the banner's Retry button) is the only way these come back.
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
      return { outcome: "terminal", batchLength: batch.length, maxAttempts: 0 };
    }

    // B-retry-3b — a 400 means the server rejected the batch deterministically
    // (malformed payload, invalid shape, etc. — the push endpoint validates
    // all-or-nothing). Retrying an identical payload would fail forever, so
    // mark the whole batch terminal instead of bumping attempts endlessly.
    if (status === 400) {
      const title =
        (err as ApiError | undefined)?.problem?.title ??
        (err instanceof Error ? err.message : String(err));
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
      logger.error("sync push 400 — deterministic rejection; marked batch terminal", {
        count: batch.length,
        title,
      });
      return { outcome: "terminal", batchLength: batch.length, maxAttempts: 0 };
    }

    // Network-level or 5xx error — transient; mark all batch items as failed
    // (non-terminal) so they retry on the next flush / scheduled backoff.
    const now = new Date().toISOString();
    let maxAttempts = 0;
    await db.transaction("rw", db.pendingUploads, async () => {
      for (const item of batch) {
        const attempts = item.attempts + 1;
        maxAttempts = Math.max(maxAttempts, attempts);
        if (item.id !== undefined) {
          await db.pendingUploads.update(item.id, { attempts, lastFailedAt: now });
        }
      }
    });
    useSyncStore.getState().setLastError(err instanceof Error ? err.message : String(err));
    logger.error("sync push failed", err instanceof Error ? err : undefined);
    return { outcome: "error", batchLength: batch.length, maxAttempts };
  }

  // Build lookup maps.
  const acceptedMap = new Map(response.accepted.map((a) => [a.recordId, a]));
  const conflictMap = new Map<string, ConflictRecord>(
    response.conflicts.map((c) => [c.recordId, c]),
  );

  // Bookkeeping pass: delete accepted rows; bump attempts on genuine hard
  // failures (neither accepted nor conflicted). Conflicted rows are left
  // untouched here — they're only removed after their resolution has
  // actually succeeded (see below), so a failed resolve never loses the
  // local edit that was queued for it.
  await db.transaction("rw", db.pendingUploads, async () => {
    for (const item of batch) {
      if (acceptedMap.has(item.recordId)) {
        if (item.id !== undefined) {
          await db.pendingUploads.delete(item.id);
        }
      } else if (!conflictMap.has(item.recordId)) {
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

  // Persist each accepted record's server version into the mapping table
  // so the next edit's parentVersion is correct.
  for (const accepted of response.accepted) {
    const mapping = await getMappingByUuid(accepted.recordId);
    if (mapping) {
      await updateLastServerVersion(mapping.recordType, mapping.localId, accepted.version);
    }
  }

  // Handle conflicts outside the DB transaction above.
  const conflictItems = batch.filter((p) => conflictMap.has(p.recordId));
  for (const item of conflictItems) {
    const conflict = conflictMap.get(item.recordId)!;

    if (conflict.reason === "quota") {
      // Not a data conflict — the batch hit the family's storage quota.
      // Leave the row queued exactly as-is; it will retry on a later flush
      // once space frees up. No merge, no attempts bump (not the client's
      // fault), no deletion.
      logger.info("sync conflict: quota — leaving queued for retry", {
        recordId: item.recordId,
      });
      continue;
    }

    try {
      await resolveConflict(item, conflict);
      // Only now — after the resolution (requeue / tombstone-apply /
      // intentional no-op) has succeeded — remove the original outbox row.
      if (item.id !== undefined) {
        await db.pendingUploads.delete(item.id);
      }
    } catch (err) {
      logger.error(
        "conflict resolution failed for " + item.recordId,
        err instanceof Error ? err : undefined,
      );
      // Leave the original row in the outbox so the edit isn't lost —
      // it retries on the next flush.
    }
  }

  // Advance the pull cursor to the max familySeq among accepted records —
  // but ONLY when that run is contiguous with the current cursor position.
  // A gap means another device's records sit in between that this client
  // hasn't pulled yet; fast-forwarding past them would skip them forever.
  if (response.accepted.length > 0) {
    const familyId = batch[0].familyId;
    const seqs = response.accepted.map((a) => a.familySeq).sort((a, b) => a - b);
    const currentSeq = decodeCursor(await getCursor(familyId));
    const isContiguous = seqs.every((seq, i) => seq === currentSeq + 1 + i);
    if (isContiguous) {
      await setCursor(familyId, encodeCursor(seqs[seqs.length - 1]));
    } else {
      logger.info(
        "sync flush: accepted seqs not contiguous with cursor; leaving cursor unchanged",
        { currentSeq, seqs },
      );
    }
  }

  useSyncStore.getState().setLastSyncAt(new Date().toISOString());
  useSyncStore.getState().setLastError(null);
  logger.info("sync flush complete", {
    accepted: response.accepted.length,
    conflicts: response.conflicts.length,
  });

  return { outcome: "success", batchLength: batch.length, maxAttempts: 0 };
}

/**
 * Reads up to 50 non-terminal records from pendingUploads at a time, pushes
 * them to the server, and processes the response (accept / conflict / hard
 * failure) — looping over additional batches while the outbox still has more
 * than PUSH_BATCH_SIZE rows queued (B-retry-2d), so a single call drains a
 * large backlog rather than only ever touching the first 50.
 *
 * Concurrency: only one flush runs at a time (`flushInProgress`). A call that
 * arrives while one is already running does NOT get silently dropped — it
 * sets `pendingFlushRequested` and this function re-invokes itself once the
 * in-flight run finishes, so a write enqueued mid-flush still gets pushed
 * (B-retry-2b).
 *
 * Retry: a run that stops because of a transient (network/5xx) error
 * schedules an exponential-backoff retry (capped ~5 min, B-retry-2c). A run
 * that completes cleanly (or stops because a batch was marked terminal)
 * clears any previously-scheduled retry.
 */
export async function flushOutbox(): Promise<void> {
  if (flushInProgress) {
    pendingFlushRequested = true;
    return;
  }
  flushInProgress = true;
  useSyncStore.getState().setIsSyncing(true);

  let hadError = false;
  let maxAttemptsSeen = 1;

  try {
    for (;;) {
      const { outcome, batchLength, maxAttempts } = await flushBatchOnce();
      if (outcome === "empty" || outcome === "terminal") break;
      if (outcome === "error") {
        hadError = true;
        maxAttemptsSeen = maxAttempts;
        break;
      }
      // "success" — only keep going if this batch was a full page; a
      // shorter batch means the outbox is drained for now.
      if (batchLength < PUSH_BATCH_SIZE) break;
    }
  } finally {
    flushInProgress = false;
    useSyncStore.getState().setIsSyncing(false);
  }

  if (hadError) {
    scheduleRetry(maxAttemptsSeen);
  } else {
    clearScheduledRetry();
  }

  if (pendingFlushRequested) {
    pendingFlushRequested = false;
    flushOutbox().catch((err) => {
      logger.warn("flushOutbox.pendingFlush.failed", err instanceof Error ? err : undefined);
    });
  }
}

/**
 * Clears the `terminal` flag on every terminal outbox row (e.g. rows marked
 * terminal after a 413 quota response) and re-runs flushOutbox so they get
 * another chance. Wired to the "Retry" button on the quota banner in
 * `SyncSettings.tsx` (B-retry-3a) — terminal rows never come back on their
 * own otherwise.
 */
export async function retryTerminalUploads(): Promise<void> {
  await db.transaction("rw", db.pendingUploads, async () => {
    const terminalRows = await db.pendingUploads.filter((p) => !!p.terminal).toArray();
    for (const row of terminalRows) {
      if (row.id !== undefined) {
        await db.pendingUploads.update(row.id, {
          terminal: false,
          attempts: 0,
          lastFailedAt: null,
        });
      }
    }
  });
  useSyncStore.getState().setLastError(null);
  await flushOutbox();
}

// ── Conflict resolution (§7.6) ────────────────────────────────────────────────

async function resolveConflict(local: PendingUpload, conflict: ConflictRecord): Promise<void> {
  const addedByUserId = local.addedByUserId ?? "";
  const editedByUserId = local.editedByUserId ?? "";

  // B8 — invalid-parentVersion / record-id-conflict path: the backend
  // returns an empty currentBlob (currentVersion=0, no map) when a brand-new
  // record arrived with a non-zero parentVersion, or the record id collided
  // with another family. There's nothing to decrypt + merge — just
  // re-enqueue the existing local ciphertext with parentVersion=0 so the
  // next push treats it as a new record.
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

  // The server's current version of this record is itself a tombstone
  // (soft/hard deleted server-side, by us or another device/user). There's
  // no meaningful blob to decrypt/merge here: apply the tombstone locally by
  // identity (never decrypt) and let the server delete win — UNLESS the
  // local operation was itself a delete, in which case both sides already
  // agree and there's nothing further to do (the caller drops the outbox
  // row once this resolves without throwing).
  if (conflict.currentDeletedAt) {
    if (local.deletedAt) {
      return;
    }
    const mapping = await getMappingByUuid(local.recordId);
    if (mapping) {
      await applyTombstoneByLocalId(local.recordType, mapping.localId);
      await updateLastServerVersion(local.recordType, mapping.localId, conflict.currentVersion);
    }
    logger.info("sync conflict: server tombstone wins, local edit dropped", {
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

  // The server-side AAD meta MUST come from the conflict response's own
  // addedByUser/editedByUser — never from the local outbox row, which may be
  // stale or simply describe a different edit (the server's current version
  // could have been written by an entirely different user/device).
  const serverMeta = {
    verByte: 1 as const,
    familyId: local.familyId,
    recordId: local.recordId,
    recordType: local.recordType,
    addedByUserId: conflict.currentAddedByUser ?? addedByUserId,
    editedByUserId: conflict.currentEditedByUser ?? editedByUserId,
    updatedAtMap: conflict.currentUpdatedAtMap,
    deletedAt: conflict.currentDeletedAt ?? "",
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

  // LWW merge (whole-record via the `_all` sentinel — see merge.ts). Pass
  // editor IDs for tie-breaking (engine §7.6).
  const { mergedPayload, mergedMap } = mergePayloads(
    localPayload,
    serverPayload,
    local.updatedAtMap,
    conflict.currentUpdatedAtMap,
    editedByUserId,
    conflict.currentEditedByUser ?? "",
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
 * decrypts them, writes to the appropriate Dexie tables, and updates the
 * cursor. Loops on `hasMore` so a single call drains every backlogged page.
 * Never advances the cursor past a record that failed to decrypt or apply:
 * records within a page are processed in familySeq order (as returned by the
 * server), and the cursor is set to the last SUCCESSFULLY applied record's
 * own seq — the first failure stops all further processing (in this page
 * and any subsequent ones) so nothing after it is silently skipped. The
 * failing record — and everything after it — is simply retried on the next
 * `pullSince` call.
 */
export async function pullSince(
  familyId: string,
  cursor: string | undefined,
): Promise<PullResponse> {
  useSyncStore.getState().setIsSyncing(true);
  try {
    const { cryptoWorker } = await import("@/services/crypto/worker-client");

    let currentCursor = cursor;
    let response: PullResponse;

    for (;;) {
      response = await pullRecords({ since: currentCursor });

      let hitFailure = false;

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
          decrypted = await cryptoWorker.decryptRecordWithStoredKey(
            fromBase64Url(pulled.blob),
            meta,
          );
        } catch (err) {
          logger.warn(
            "failed to decrypt pulled record " + pulled.recordId,
            err instanceof Error ? err : undefined,
          );
          hitFailure = true;
          break;
        }

        const payload = JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;

        try {
          await writeDecryptedRecord(pulled.recordType, payload, pulled);
        } catch (err) {
          logger.warn(
            "failed to apply pulled record " + pulled.recordId,
            err instanceof Error ? err : undefined,
          );
          hitFailure = true;
          break;
        }

        // Successfully applied — advance the cursor to exactly this record's
        // own seq (never further), so a later failure in the same page can't
        // retroactively skip it.
        const appliedCursor = encodeCursor(pulled.familySeq);
        await setCursor(familyId, appliedCursor);
        currentCursor = appliedCursor;
      }

      if (hitFailure) {
        // Stop entirely: fetching another page would use the server's
        // nextCursor, which sits beyond the failed record and would skip it
        // forever. The next pullSince call retries from the last good cursor.
        break;
      }

      if (!response.hasMore) {
        // Adopt the server's own nextCursor verbatim — covers the
        // zero-records-in-this-page case, where the per-record loop above
        // never ran and `currentCursor` is otherwise unchanged.
        await setCursor(familyId, response.nextCursor);
        currentCursor = response.nextCursor;
        break;
      }

      currentCursor = response.nextCursor;
    }

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
 * Resolves the local Dexie id already mapped to a server `uuid`, or
 * `undefined` if this device has never seen that uuid before.
 */
async function resolveLocalIdForUuid(uuid: string | undefined): Promise<number | undefined> {
  if (!uuid) return undefined;
  const existing = await getMappingByUuid(uuid);
  if (!existing) return undefined;
  const id = Number(existing.localId);
  return Number.isNaN(id) ? undefined : id;
}

/**
 * Applies a tombstone to the local row identified by an ALREADY-RESOLVED
 * `localId` (via the record mapping — never the foreign device's embedded
 * `payload.id`). Accounts/categories soft-delete (`isTrashed = true`,
 * keeping the trash view intact); transactions/budgets hard-delete by id.
 */
async function applyTombstoneByLocalId(recordType: RecordType, localId: string): Promise<void> {
  const id = Number(localId);
  if (Number.isNaN(id)) return;
  switch (recordType) {
    case "transaction":
      await db.transactions.delete(id);
      return;
    case "account":
      await db.accounts.update(id, { isTrashed: true });
      return;
    case "category":
      await db.categories.update(id, { isTrashed: true });
      return;
    case "budget":
      await db.budgets.delete(id);
      return;
    case "settings":
      // Settings tombstones are keyed by string, handled separately in
      // writeDecryptedRecord — never routed through this numeric-id path.
      return;
  }
}

/**
 * Upserts a domain-table row (transaction/account/category/budget) for a
 * pulled record, translating the server `uuid` → this device's local id via
 * the record mapping. NEVER trusts `payload.id`: that's the ORIGINATING
 * device's Dexie auto-increment id, which is meaningless — and can collide
 * with an unrelated local row — on this device.
 *
 * If the uuid is already mapped, the existing local row is overwritten
 * (`putRow` with `id` forced to the mapped localId). Otherwise this is a
 * genuinely new record from another device: the foreign `id` is stripped,
 * `addRow` lets Dexie mint a fresh local id, and that id is persisted as the
 * mapping's `localId`.
 */
async function upsertDomainRow(
  recordType: RecordType,
  payload: Record<string, unknown>,
  uuid: string | undefined,
  creatorUserId: string,
  version: number,
  putRow: (row: Record<string, unknown>) => Promise<number | undefined>,
  addRow: (row: Record<string, unknown>) => Promise<number | undefined>,
): Promise<void> {
  const mappedLocalId = await resolveLocalIdForUuid(uuid);
  let localId: number;
  if (mappedLocalId !== undefined) {
    localId = mappedLocalId;
    await putRow({ ...payload, id: localId });
  } else {
    // Strip the foreign device's embedded id — Dexie mints a fresh one.
    const withoutId: Record<string, unknown> = { ...payload };
    delete withoutId.id;
    const newId = await addRow(withoutId);
    if (newId === undefined) {
      logger.warn("pullSince: " + recordType + " insert did not return a new id, skipping mapping");
      return;
    }
    localId = newId;
  }
  if (uuid) {
    await upsertMappingFromPull(recordType, String(localId), uuid, creatorUserId, version);
  }
}

// ── Balance-aware pulled-transaction handling ───────────────────────────────
//
// Account.balance is STORED, not derived (see root CLAUDE.md "Key data
// rules"). Historically `writeDecryptedRecord` `put`/`add`ed pulled
// transactions and hard-deleted tombstoned ones without ever touching the
// affected account's balance, and pulled ACCOUNT records were whole-record
// LWW-clobbered — including their `balance` field. Two devices editing
// concurrently would silently desync/lose money. The functions below make
// every pulled transaction create/update/tombstone apply the exact same
// delta math as `balance.service.ts` (via the shared, exported
// `getBalanceDelta`), and keep a locally-known account's `balance` under
// this device's own control rather than the sender's snapshot.

/**
 * Reverts a transaction's balance effect from its account, if the account is
 * known locally. Logs and no-ops (never throws) when the account is
 * missing — the transaction row itself is still written/removed by the
 * caller; the balance simply can't be corrected against an account this
 * device hasn't received yet (it will already reflect this transaction via
 * its own eventual create-snapshot — see `upsertPulledAccount`).
 */
async function revertTransactionBalance(tx: Transaction): Promise<void> {
  const account = await db.accounts.get(tx.accountId);
  if (!account) {
    logger.warn(
      "pullSince: transaction references an account not known locally; balance not adjusted",
      {
        accountId: tx.accountId,
      },
    );
    return;
  }
  const delta = getBalanceDelta(account, tx);
  await db.accounts.update(tx.accountId, {
    balance: account.balance - delta,
    updatedAt: new Date().toISOString(),
  });
}

/** Applies a transaction's balance effect to its account. See {@link revertTransactionBalance}. */
async function applyTransactionBalance(tx: Transaction): Promise<void> {
  const account = await db.accounts.get(tx.accountId);
  if (!account) {
    logger.warn(
      "pullSince: transaction references an account not known locally; balance not adjusted",
      {
        accountId: tx.accountId,
      },
    );
    return;
  }
  const delta = getBalanceDelta(account, tx);
  await db.accounts.update(tx.accountId, {
    balance: account.balance + delta,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Upserts a pulled, non-tombstone transaction while keeping its account's
 * stored balance correct:
 *   - CREATE (no local row mapped to this uuid yet): insert the row, then
 *     apply its delta.
 *   - UPDATE (a local row is already mapped): revert the OLD local row's
 *     delta, apply the NEW payload's delta, then write the row. Reverting
 *     against the old row's own `accountId` and applying against the new
 *     payload's own `accountId` transparently handles an account change
 *     between edits (they may even be the same account — sequential
 *     get+update is still correct there).
 * Everything happens inside one `db.transaction('rw', ...)` so a crash never
 * leaves the row and the balance out of sync. Never trusts `payload.id` —
 * see `upsertDomainRow`'s doc for why.
 */
async function upsertPulledTransaction(
  payload: Record<string, unknown>,
  uuid: string | undefined,
  creatorUserId: string,
  version: number,
): Promise<void> {
  await db.transaction("rw", [db.transactions, db.accounts, db.recordMappings], async () => {
    const mappedLocalId = await resolveLocalIdForUuid(uuid);

    if (mappedLocalId !== undefined) {
      const oldRow = await db.transactions.get(mappedLocalId);
      if (oldRow) {
        await revertTransactionBalance(oldRow);
      }
      const newRow = { ...payload, id: mappedLocalId } as unknown as Transaction;
      await applyTransactionBalance(newRow);
      await db.transactions.put(newRow as Parameters<typeof db.transactions.put>[0]);
      if (uuid) {
        await upsertMappingFromPull(
          "transaction",
          String(mappedLocalId),
          uuid,
          creatorUserId,
          version,
        );
      }
      return;
    }

    // CREATE — strip the foreign device's embedded id, let Dexie mint one.
    const withoutId: Record<string, unknown> = { ...payload };
    delete withoutId.id;
    const newId = await db.transactions.add(withoutId as Parameters<typeof db.transactions.add>[0]);
    if (newId === undefined) {
      logger.warn("pullSince: transaction insert did not return a new id, skipping mapping");
      return;
    }
    const newRow = { ...payload, id: newId } as unknown as Transaction;
    await applyTransactionBalance(newRow);
    if (uuid) {
      await upsertMappingFromPull("transaction", String(newId), uuid, creatorUserId, version);
    }
  });
}

/**
 * Applies a pulled transaction tombstone: reverts the local row's balance
 * delta (if both the row and its account are known locally), then
 * hard-deletes it. No-ops if this device never had a local copy.
 */
async function applyPulledTransactionTombstone(
  uuid: string | undefined,
  creatorUserId: string,
  version: number,
): Promise<void> {
  await db.transaction("rw", [db.transactions, db.accounts, db.recordMappings], async () => {
    const localId = await resolveLocalIdForUuid(uuid);
    if (localId === undefined) return; // never had a local copy — nothing to tombstone
    const row = await db.transactions.get(localId);
    if (row) {
      await revertTransactionBalance(row);
    }
    await db.transactions.delete(localId);
    if (uuid) {
      await upsertMappingFromPull("transaction", String(localId), uuid, creatorUserId, version);
    }
  });
}

/**
 * Upserts a pulled, non-tombstone account:
 *   - Brand new locally (no mapping yet): created verbatim, INCLUDING the
 *     payload's `balance` — it's an authoritative snapshot from the sender
 *     that already reflects every transaction applied to it at push time.
 *     Any pulled transaction for this account processed elsewhere in the
 *     same pull page must NOT be re-applied against this snapshot — and it
 *     never is, since `upsertPulledTransaction` only ever adjusts an
 *     account that is already present in `db.accounts` at the time it runs.
 *   - Already known locally: every field EXCEPT `balance` is overwritten
 *     from the payload — this device's own stored balance (maintained by
 *     every local transaction it has ever applied) is authoritative and
 *     must never be clobbered by a stale/foreign snapshot value. See the
 *     accepted-limitation note in this package's CLAUDE.md re: manual
 *     "Adjust balance" edits.
 */
async function upsertPulledAccount(
  payload: Record<string, unknown>,
  uuid: string | undefined,
  creatorUserId: string,
  version: number,
): Promise<void> {
  await db.transaction("rw", [db.accounts, db.recordMappings], async () => {
    const mappedLocalId = await resolveLocalIdForUuid(uuid);

    if (mappedLocalId !== undefined) {
      const rest: Record<string, unknown> = { ...payload };
      delete rest.balance;
      delete rest.id;
      await db.accounts.update(mappedLocalId, rest);
      if (uuid) {
        await upsertMappingFromPull("account", String(mappedLocalId), uuid, creatorUserId, version);
      }
      return;
    }

    const withoutId: Record<string, unknown> = { ...payload };
    delete withoutId.id;
    const newId = await db.accounts.add(withoutId as Parameters<typeof db.accounts.add>[0]);
    if (newId === undefined) {
      logger.warn("pullSince: account insert did not return a new id, skipping mapping");
      return;
    }
    if (uuid) {
      await upsertMappingFromPull("account", String(newId), uuid, creatorUserId, version);
    }
  });
}

/**
 * Refreshes the in-memory Zustand settings-store cache after a pulled
 * settings record is written to Dexie, so a remote change is reflected in
 * the UI immediately (`SettingsView` etc. read from the store, not Dexie
 * directly). Dynamically imported to avoid pulling the store (and its own
 * import chain through `push-helpers.ts`) into every module that merely
 * imports the sync engine.
 */
async function refreshSettingsStoreCache(key: string, value: unknown): Promise<void> {
  try {
    const { useSettingsStore } = await import("@/stores/settings-store");
    useSettingsStore.setState({ [key]: value } as unknown as Partial<
      ReturnType<(typeof useSettingsStore)["getState"]>
    >);
  } catch (err) {
    logger.warn("pullSince: settings store refresh failed", err instanceof Error ? err : undefined);
  }
}

/**
 * B8 — tombstone propagation. When the pulled record carries a non-empty
 * `deletedAt`, the payload represents a soft-deleted row. For accounts and
 * categories we keep the local row (Dexie soft-delete: `isTrashed = true`)
 * so the trash views still work. For transactions / budgets we hard-delete
 * the local row by id; settings delete by key.
 *
 * `meta.recordId` is the server's UUID identity — it is translated to this
 * device's local id via the record mapping (`record-mapping.ts`) rather than
 * ever trusting `payload.id`, which belongs to whichever device originally
 * created the row and is meaningless (or actively dangerous) here.
 */
export async function writeDecryptedRecord(
  recordType: string,
  payload: Record<string, unknown>,
  meta?: Pick<PulledRecord, "deletedAt" | "recordId" | "addedByUser" | "version">,
): Promise<void> {
  const isTombstone = !!(meta && meta.deletedAt && meta.deletedAt !== "");
  const uuid = meta?.recordId;
  const creatorUserId = meta?.addedByUser ?? "";
  const version = meta?.version ?? 0;

  switch (recordType) {
    case "transaction": {
      if (isTombstone) {
        await applyPulledTransactionTombstone(uuid, creatorUserId, version);
        return;
      }
      const result = transactionSchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid transaction payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await upsertPulledTransaction(payload, uuid, creatorUserId, version);
      break;
    }
    case "account": {
      if (isTombstone) {
        const localId = await resolveLocalIdForUuid(uuid);
        if (localId === undefined) return;
        await db.accounts.update(localId, { isTrashed: true });
        if (uuid)
          await upsertMappingFromPull("account", String(localId), uuid, creatorUserId, version);
        return;
      }
      const result = accountSchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid account payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await upsertPulledAccount(payload, uuid, creatorUserId, version);
      break;
    }
    case "category": {
      if (isTombstone) {
        const localId = await resolveLocalIdForUuid(uuid);
        if (localId === undefined) return;
        await db.categories.update(localId, { isTrashed: true });
        if (uuid)
          await upsertMappingFromPull("category", String(localId), uuid, creatorUserId, version);
        return;
      }
      const result = categorySchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid category payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await upsertDomainRow(
        "category",
        payload,
        uuid,
        creatorUserId,
        version,
        (row) => db.categories.put(row as Parameters<typeof db.categories.put>[0]),
        (row) => db.categories.add(row as Parameters<typeof db.categories.add>[0]),
      );
      break;
    }
    case "budget": {
      if (isTombstone) {
        const localId = await resolveLocalIdForUuid(uuid);
        if (localId === undefined) return;
        await db.budgets.delete(localId);
        if (uuid)
          await upsertMappingFromPull("budget", String(localId), uuid, creatorUserId, version);
        return;
      }
      const result = budgetSchema.safeParse(payload);
      if (!result.success) {
        logger.warn("pullSince: invalid budget payload, skipping", {
          issues: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      await upsertDomainRow(
        "budget",
        payload,
        uuid,
        creatorUserId,
        version,
        (row) => db.budgets.put(row as Parameters<typeof db.budgets.put>[0]),
        (row) => db.budgets.add(row as Parameters<typeof db.budgets.add>[0]),
      );
      break;
    }
    case "settings": {
      // Settings are keyed by their own stable string key — no id-collision
      // risk across devices, so no numeric-id translation is needed.
      const key = (payload as { key?: unknown }).key;
      if (typeof key !== "string" || !("value" in payload)) {
        logger.warn("pullSince: settings payload missing key/value, skipping");
        return;
      }
      // B-retry-6a — never trust a pulled settings key blindly: only the
      // small allow-list this device itself would push (`SYNCED_SETTING_KEYS`)
      // is applied. Anything else is dropped (not an error — treated as
      // successfully processed so the pull cursor still advances past it).
      if (!SYNCED_SETTING_KEYS.has(key)) {
        logger.warn("pullSince: settings key not in sync allow-list, dropping", { key });
        return;
      }
      const value = (payload as { value: unknown }).value;
      if (isTombstone) {
        await db.settings.delete(key);
        if (uuid) await upsertMappingFromPull("settings", key, uuid, creatorUserId, version);
        return;
      }
      await db.settings.put({ key, value });
      if (uuid) await upsertMappingFromPull("settings", key, uuid, creatorUserId, version);
      // B-retry-6b — keep the in-memory Zustand settings-store cache in sync
      // so a remote change (e.g. mainCurrency edited on another device) is
      // visible immediately, without requiring a reload.
      await refreshSettingsStoreCache(key, value);
      break;
    }
    default:
      logger.warn("pullSince: unknown recordType " + recordType);
  }
}

// ── startLiveSync ─────────────────────────────────────────────────────────────

/** Minimum interval between SSE-triggered pulls (ms). */
const PULL_DEBOUNCE_MS = 500;

/**
 * Wipes every local Dexie domain table + stored crypto key material, signs
 * out, and navigates to onboarding. Shared by the `you.removed` SSE event
 * and the `device.revoked` event when the revoked device is THIS device
 * (B-retry-5) — both represent "this device has been forcibly removed from
 * the family/account" and must leave zero local trace behind.
 */
async function wipeLocalStateAndSignOut(): Promise<void> {
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
    logger.warn("liveSync.wipeLocalState.clearKeys.failed", err instanceof Error ? err : undefined);
  }
  // Sign out via auth store.
  const { useAuthStore } = await import("@/services/auth/session");
  await useAuthStore.getState().signOut();
  // Navigate to onboarding — full reload clears in-memory state.
  window.location.assign("/onboarding");
}

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
 * - `device.revoked` → if it's THIS device, wipes local state + signs out
 *                      (same path as `you.removed`); otherwise just logged.
 * - `you.removed`    → clears local Dexie data + signs out.
 *
 * Also wires a `window` "online" listener (B-retry-2a) — reconnecting to
 * the network flushes the outbox and runs a catch-up pull, since neither
 * happens automatically otherwise (SSE reconnect alone doesn't push queued
 * local writes, and the offline window may have missed `record.changed`
 * events entirely).
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

  function handleOnline() {
    logger.info("liveSync.online", { familyId });
    flushOutbox().catch((err) => {
      logger.warn("liveSync.online.flush.failed", err instanceof Error ? err : undefined);
    });
    (async () => {
      try {
        const cursor = await getCursor(familyId);
        await pullSince(familyId, cursor);
      } catch (err) {
        logger.warn("liveSync.online.pull.failed", err instanceof Error ? err : undefined);
      }
    })();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
  }

  const handle = connectSSE({
    onOpen: () => {
      logger.info("liveSync.connected", { familyId });
      // B-retry-4a — a (re)connect may have missed events entirely (initial
      // connect, or a gap while disconnected/reconnecting); always catch up
      // from the last known cursor rather than assuming SSE replays anything.
      (async () => {
        try {
          const cursor = await getCursor(familyId);
          await pullSince(familyId, cursor);
        } catch (err) {
          logger.warn("liveSync.onOpen.pull.failed", err instanceof Error ? err : undefined);
        }
      })();
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
              // Seed the local familyId immediately — this device may be
              // activating before its first-ever pull, so `syncCursors` has
              // no row yet and `getLocalFamilyId()` would otherwise return
              // null until the pull below completes (a window in which any
              // local write couldn't be queued for push).
              await setLocalFamilyId(familyId);
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
        case "device.revoked": {
          const p = payload as SSEPayloadMap["device.revoked"];
          (async () => {
            try {
              const { useAuthStore } = await import("@/services/auth/session");
              const thisDeviceId = useAuthStore.getState().device?.id;
              if (thisDeviceId && p.deviceId === thisDeviceId) {
                logger.warn("liveSync.device.revoked.self", {
                  deviceId: p.deviceId,
                  reason: p.reason,
                });
                await wipeLocalStateAndSignOut();
              } else {
                logger.info("liveSync.device.revoked.other", {
                  deviceId: p.deviceId,
                  reason: p.reason,
                });
              }
            } catch (err) {
              logger.error(
                "liveSync.device.revoked.failed",
                err instanceof Error ? err : undefined,
              );
            }
          })();
          break;
        }
        case "you.removed": {
          (async () => {
            try {
              await wipeLocalStateAndSignOut();
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
              // B-retry-10 — clear stale outbox rows first: their
              // parentVersions refer to a server state the barrier just
              // replaced wholesale, so blindly re-pushing them would only
              // churn/conflict forever. Then pull from scratch (cursor
              // omitted) so the local DB is fully rebuilt from the restored
              // state, letting pullSince's own bookkeeping advance the
              // cursor record-by-record. Do NOT pre-adopt `p.cursor` here:
              // if the pull below throws before applying anything (e.g. the
              // very first network request fails), a pre-set cursor would be
              // left sitting AT the barrier's final position with zero
              // records actually applied locally — a later retry would then
              // pull `since=p.cursor` and get nothing, permanently orphaning
              // the rebuild.
              await db.pendingUploads.clear();
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
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
    }
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
