// Push helpers — convenience wrappers around `enqueuePush` for the write paths
// in balance.service, account/category/budget forms, and the settings store.
//
// Responsibilities:
//   * Look up the active `familyId` (returns early if the device isn't signed
//     in to a family yet — local-only mode).
//   * Resolve the current `userId` from the auth store as the editor (and the
//     creator, on insert).
//   * Build a `RawRecord` with stable `recordId = String(local DB id)` and a
//     coarse `updatedAtMap = { _all: <now> }`.
//   * Swallow errors so the local DB write that happened first is not undone
//     when the sync layer is offline / unavailable; the engine's outbox is the
//     real durability boundary, and a failure here just means no row was added
//     to the outbox.

import { logger } from "@/services/log.service";
import { useAuthStore } from "@/services/auth/session";
import { getLocalFamilyId } from "@/services/family/active-family";
import { enqueuePush } from "./engine";
import type { Account, Budget, Category, Transaction } from "@/db/models";
import type { RawRecord, RecordType } from "./types";

/** Settings keys that should sync to the server (cosmetic / per-device ones do not). */
export const SYNCED_SETTING_KEYS = new Set<string>(["mainCurrency", "monthStartDay"]);

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

// ── Transactions ─────────────────────────────────────────────────────────────

export async function pushTransaction(tx: Transaction): Promise<void> {
  if (tx.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const now = nowIso();
  await safeEnqueue({
    recordId: String(tx.id),
    recordType: "transaction",
    familyId: ctx.familyId,
    addedByUserId: ctx.userId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    parentVersion: 0,
    payload: tx,
  });
}

export async function pushTransactionTombstone(tx: Transaction): Promise<void> {
  if (tx.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const now = nowIso();
  await safeEnqueue({
    recordId: String(tx.id),
    recordType: "transaction",
    familyId: ctx.familyId,
    addedByUserId: ctx.userId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    deletedAt: now,
    parentVersion: 0,
    payload: { ...tx, isTrashed: true },
  });
}

// ── Accounts / Categories / Budgets ──────────────────────────────────────────

export async function pushAccount(account: Account): Promise<void> {
  if (account.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const now = nowIso();
  await safeEnqueue({
    recordId: String(account.id),
    recordType: "account",
    familyId: ctx.familyId,
    addedByUserId: ctx.userId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    deletedAt: account.isTrashed ? now : undefined,
    parentVersion: 0,
    payload: account,
  });
}

export async function pushCategory(category: Category): Promise<void> {
  if (category.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const now = nowIso();
  await safeEnqueue({
    recordId: String(category.id),
    recordType: "category",
    familyId: ctx.familyId,
    addedByUserId: ctx.userId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    deletedAt: category.isTrashed ? now : undefined,
    parentVersion: 0,
    payload: category,
  });
}

export async function pushBudget(budget: Budget): Promise<void> {
  if (budget.id === undefined) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const now = nowIso();
  await safeEnqueue({
    recordId: String(budget.id),
    recordType: "budget",
    familyId: ctx.familyId,
    addedByUserId: ctx.userId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    parentVersion: 0,
    payload: budget,
  });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function pushSetting(key: string, value: unknown): Promise<void> {
  if (!SYNCED_SETTING_KEYS.has(key)) return;
  const ctx = await pushContext();
  if (!ctx) return;
  const now = nowIso();
  await safeEnqueue({
    recordId: "setting:" + key,
    recordType: "settings" as RecordType,
    familyId: ctx.familyId,
    addedByUserId: ctx.userId,
    editedByUserId: ctx.userId,
    updatedAtMap: { _all: now },
    parentVersion: 0,
    payload: { key, value },
  });
}
