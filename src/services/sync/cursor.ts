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
 * Decodes an opaque base64url cursor back to its familySeq integer. Mirrors
 * the backend's `DecodeCursor`: a missing/empty/malformed cursor decodes to
 * seq 0 (full sync from the beginning) rather than throwing — this is only
 * used client-side for the "is this fast-forward contiguous?" check in
 * `flushOutbox`, where a defensive fallback to 0 is the safe choice.
 */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const b64 = padded + "=".repeat(padLen);
    const binary = atob(b64);
    if (binary.length !== 8) return 0;
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const hi = view.getUint32(0, false);
    const lo = view.getUint32(4, false);
    return hi * 0x100000000 + lo;
  } catch {
    return 0;
  }
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
