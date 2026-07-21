// Reads / persists the active familyId. This is the ONE canonical source
// used by every caller that needs "what family is this device syncing
// with?" — the live sync engine, push-helpers, background-sync catch-up,
// and various settings screens.
//
// Canonical persisted location: the first row of Dexie `syncCursors`
// (`familyId` is its primary key — one row per family this device has ever
// synced with; the single-family model means at most one). `setLocalFamilyId`
// seeds that row (with an explicit "pull from the beginning" cursor) at
// every point a familyId becomes known BEFORE the first real pull has run:
// family creation (`family/init.ts`), device activation (`sync/engine.ts`
// `device.activated`), and recovery-envelope unwrap (`DeviceJoinWaiting.tsx`).
// A successful `pullSince` also seeds/refreshes this row as a side effect
// (via `cursor.ts:setCursor`), so once any pull has ever succeeded this is
// self-sustaining.
//
// `getLocalFamilyId` falls back to the auth store's `family.id` (hydrated by
// `refreshMe()` from `GET /v1/me`) when no syncCursors row exists yet — this
// covers a brand-new/pending device that reloaded before ever calling
// `setLocalFamilyId`/`pullSince` (e.g. mid-onboarding on a fresh tab).

import { db } from "@/db/database";
import { useAuthStore } from "@/services/auth/session";
import { setCursor, encodeCursor } from "@/services/sync/cursor";

/**
 * Returns the local familyId: the first `syncCursors` row if one exists,
 * else the auth store's hydrated `family.id`, else `null` (never signed into
 * a family — local-only/solo mode).
 */
export async function getLocalFamilyId(): Promise<string | null> {
  const row = await db.syncCursors.toCollection().first();
  if (row?.familyId) return row.familyId;
  return useAuthStore.getState().family?.id ?? null;
}

/**
 * Seeds the canonical `syncCursors` row for `familyId` with an empty
 * ("pull from the beginning") cursor, if one doesn't already exist. Safe to
 * call repeatedly / speculatively — never clobbers real pull progress.
 */
export async function setLocalFamilyId(familyId: string): Promise<void> {
  const existing = await db.syncCursors.get(familyId);
  if (existing) return;
  await setCursor(familyId, encodeCursor(0));
}
