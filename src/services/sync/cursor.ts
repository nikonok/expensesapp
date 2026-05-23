// Per-family sync cursor persistence (Dexie syncCursors table).
// Architecture §6.2 — cursor is an opaque base64url value returned by pull.

import { db } from "@/db/database";
import type { SyncCursor } from "./types";

/**
 * Encodes a familySeq integer as an opaque base64url cursor string.
 * Mirrors the backend's EncodeCursor: 8-byte big-endian uint64, base64url raw.
 */
export function encodeCursor(seq: number): string {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // JavaScript numbers are float64; familySeq fits in a safe integer (< 2^53).
  // Write as two 32-bit halves to avoid BigInt dependency.
  const hi = Math.floor(seq / 0x100000000);
  const lo = seq >>> 0;
  view.setUint32(0, hi, false); // big-endian high word
  view.setUint32(4, lo, false); // big-endian low word
  const bytes = new Uint8Array(buf);
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

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
