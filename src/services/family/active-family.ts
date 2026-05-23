// Reads the active family ID from the local sync cursors table.
// The syncCursors table stores one row per family the device has synced with;
// in the single-family model there is exactly one row after the first pull.

import { db } from "@/db/database";

/**
 * Returns the local familyId by reading the first sync cursor row.
 * Returns null if no sync has occurred yet (e.g., fresh device before first pull).
 */
export async function getLocalFamilyId(): Promise<string | null> {
  const row = await db.syncCursors.toCollection().first();
  return row?.familyId ?? null;
}
