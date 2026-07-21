// Push helpers — convenience wrappers around `enqueuePush` for the write paths
// in balance.service, account/category/budget forms, and the settings store.
//
// Responsibilities:
//   * Look up the active `familyId` (returns early if the device isn't signed
//     in to a family yet — local-only mode).
//   * Resolve the current `userId` from the auth store as the editor.
//   * Resolve the record's stable server UUID + `parentVersion` +
//     `creatorUserId` via the canonical `recordMappings` table (see
//     `record-mapping.ts`) — minting a fresh UUID mapping on first push.
//   * Build a `RawRecord` with `addedByUserId` = the record's ORIGINAL
//     creator (never the current editor, unless they're the same) and a
//     coarse `updatedAtMap = { _all: <now> }` (whole-record LWW).
//   * Swallow errors so the local DB write that happened first is not undone
//     when the sync layer is offline / unavailable; the engine's outbox is the
//     real durability boundary, and a failure here just means no row was added
//     to the outbox.

import { logger } from "@/services/log.service";
import { useAuthStore } from "@/services/auth/session";
import { getLocalFamilyId } from "@/services/family/active-family";
import { enqueuePush } from "./engine";
import { getOrCreateMappingForPush } from "./record-mapping";
import type { Account, Budget, Category, Transaction } from "@/db/models";
import type { RawRecord, RecordType } from "./types";

/** Settings keys that should sync to the server (cosmetic / per-device ones do not). */
export const SYNCED_SETTING_KEYS = new Set<string>(["mainCurrency"]);

interface PushContext {
  familyId: string;
  userId: string;
}

/**
 * Returns `null` if the device is not signed in or has no active family yet —
 * in that case the write is still committed locally; nothing goes to the outbox.
 */
async function pushContext(): Promise<PushContext | null> {
  const familyId = await getLocalFamilyId();
  if (!familyId) return null;
  const userId = useAuthStore.getState().user?.id ?? null;
  if (!userId) return null;
  return { familyId, userId };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function safeEnqueue(record: RawRecord): Promise<void> {
  try {
    await enqueuePush(record);
  } catch (err) {
    logger.warn(
      "sync.enqueue.failed " + record.recordType + " " + record.recordId,
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Resolves the wire identity for a local record about to be pushed:
 * `{ recordId, addedByUserId, parentVersion }`, minting a mapping on first
 * push. `addedByUserId` is the record's ORIGINAL creator (the mapping's
 * `creatorUserId`), never overwritten by later edits from other users.
 */
async function resolvePushIdentity(
  recordType: RecordType,
  localId: string,
  currentUserId: string,
): Promise<{ recordId: string; addedByUserId: string; parentVersion: number }> {
  const mapping = await getOrCreateMappingForPush(recordType, localId, currentUserId);
  return {
    recordId: mapping.uuid,
    addedByUserId: mapping.creatorUserId,
    parentVersion: mapping.lastServerVersion,
  };
}

// ── Transactions ─────────────────────────────────────────────────────────────

export async function pushTransaction(tx: Transaction): Promise<void> {
  if (tx.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const identity = await resolvePushIdentity("transaction", String(tx.id), ctx.userId);
  const now = nowIso();
  await safeEnqueue({
    recordId: identity.recordId,
    recordType: "transaction",
    familyId: ctx.familyId,
    addedByUserId: identity.addedByUserId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    parentVersion: identity.parentVersion,
    payload: tx,
  });
}

export async function pushTransactionTombstone(tx: Transaction): Promise<void> {
  if (tx.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const identity = await resolvePushIdentity("transaction", String(tx.id), ctx.userId);
  const now = nowIso();
  await safeEnqueue({
    recordId: identity.recordId,
    recordType: "transaction",
    familyId: ctx.familyId,
    addedByUserId: identity.addedByUserId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    deletedAt: now,
    parentVersion: identity.parentVersion,
    payload: { ...tx, isTrashed: true },
  });
}

// ── Accounts / Categories / Budgets ──────────────────────────────────────────

export async function pushAccount(account: Account): Promise<void> {
  if (account.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const identity = await resolvePushIdentity("account", String(account.id), ctx.userId);
  const now = nowIso();
  await safeEnqueue({
    recordId: identity.recordId,
    recordType: "account",
    familyId: ctx.familyId,
    addedByUserId: identity.addedByUserId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    deletedAt: account.isTrashed ? now : undefined,
    parentVersion: identity.parentVersion,
    payload: account,
  });
}

export async function pushCategory(category: Category): Promise<void> {
  if (category.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const identity = await resolvePushIdentity("category", String(category.id), ctx.userId);
  const now = nowIso();
  await safeEnqueue({
    recordId: identity.recordId,
    recordType: "category",
    familyId: ctx.familyId,
    addedByUserId: identity.addedByUserId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    deletedAt: category.isTrashed ? now : undefined,
    parentVersion: identity.parentVersion,
    payload: category,
  });
}

export async function pushBudget(budget: Budget): Promise<void> {
  if (budget.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const identity = await resolvePushIdentity("budget", String(budget.id), ctx.userId);
  const now = nowIso();
  await safeEnqueue({
    recordId: identity.recordId,
    recordType: "budget",
    familyId: ctx.familyId,
    addedByUserId: identity.addedByUserId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    parentVersion: identity.parentVersion,
    payload: budget,
  });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function pushSetting(key: string, value: unknown): Promise<void> {
  if (!SYNCED_SETTING_KEYS.has(key)) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const identity = await resolvePushIdentity("settings" as RecordType, key, ctx.userId);
  const now = nowIso();
  await safeEnqueue({
    recordId: identity.recordId,
    recordType: "settings" as RecordType,
    familyId: ctx.familyId,
    addedByUserId: identity.addedByUserId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    parentVersion: identity.parentVersion,
    payload: { key, value },
  });
}
