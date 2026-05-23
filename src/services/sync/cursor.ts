// Per-family sync cursor persistence (Dexie syncCursors table).
// Architecture §6.2 — cursor is an opaque base64url value returned by pull.

import { db } from "@/db/database";
import type { SyncCursor } from "./types";

/**
 * Returns the current pull cursor for the given familyId,
 * or undefined if no pull has been performed yet.
 */
export async function getCursor(familyId: string): Promise<string | undefined> {
  const row = await db.syncCursors.get(familyId);
  return row?.cursor;
}

/**
 * Persists a new cursor value after a successful pull.
 * Creates the row if it doesn't exist.
 */
export async function setCursor(familyId: string, cursor: string): Promise<void> {
  const row: SyncCursor = {
    familyId,
    cursor,
    updatedAt: new Date().toISOString(),
  };
  await db.syncCursors.put(row);
}
