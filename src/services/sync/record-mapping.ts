// Canonical local↔server record-identity mapping (Dexie `recordMappings`, v8).
//
// This is the ONE mapping table shared by the live sync engine (this
// package) and the solo→family migration path (`services/family/migrate.ts`)
// — see WORK_PLAN.md / architecture §6.2. It replaces:
//   * push-helpers.ts's old `recordId = String(dexieAutoIncrementId)` scheme
//     (auto-increment ids collide across devices and are not valid UUIDs —
//     the server 400s on `uuid.Parse`).
//   * migrate.ts's old ad-hoc `db.settings` UUID map
//     (`family.migration.recordIds:<recordType>`).
//
// Each row maps `(recordType, localId)` → a stable server-facing `uuid`,
// plus the bookkeeping needed to push correct `parentVersion` /
// `addedByUserId` on every subsequent edit:
//   - `lastServerVersion` — the last server `version` seen for this record,
//     via push-accept (engine.ts flushOutbox) or pull (engine.ts pullSince).
//     0 means "never synced" → the next push's parentVersion must be 0.
//   - `creatorUserId` — the record's ORIGINAL creator. Set once, on first
//     push (this device is the creator) or first pull (the server's
//     addedByUser is the creator), and never overwritten afterwards.

import { db } from "@/db/database";
import type { RecordMapping } from "@/db/models";
import type { RecordType } from "./types";

/**
 * Generate a UUID. Prefers the platform `crypto.randomUUID()` (UUIDv4).
 * Falls back to manually-built v4 bytes in test environments where
 * `crypto.randomUUID` is not exposed (older Node / some jsdom setups).
 */
export function newUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const rnd = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(rnd);
  } else {
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 256);
  }
  rnd[6] = (rnd[6] & 0x0f) | 0x40;
  rnd[8] = (rnd[8] & 0x3f) | 0x80;
  const hex = Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Look up a mapping by its local identity — the "outgoing" (push) direction. */
export async function getMappingByLocalId(
  recordType: RecordType,
  localId: string,
): Promise<RecordMapping | undefined> {
  return db.recordMappings.where("[recordType+localId]").equals([recordType, localId]).first();
}

/** Look up a mapping by its server uuid — the "incoming" (pull) direction. */
export async function getMappingByUuid(uuid: string): Promise<RecordMapping | undefined> {
  return db.recordMappings.get(uuid);
}

/**
 * Resolve (or mint) the mapping for a local record about to be pushed.
 *
 * If no mapping exists yet, this device is the originating creator: mint a
 * fresh UUID, persist `creatorUserId = currentUserId`, and start
 * `lastServerVersion` at 0 (so the caller sends `parentVersion: 0`).
 *
 * If a mapping already exists, it is returned unchanged — callers must NOT
 * mutate `creatorUserId` on subsequent pushes; the original creator is
 * carried forward as `addedByUserId` on every edit.
 */
export async function getOrCreateMappingForPush(
  recordType: RecordType,
  localId: string,
  currentUserId: string,
): Promise<RecordMapping> {
  const existing = await getMappingByLocalId(recordType, localId);
  if (existing) return existing;
  const mapping: RecordMapping = {
    recordType,
    localId,
    uuid: newUUID(),
    lastServerVersion: 0,
    creatorUserId: currentUserId,
  };
  await db.recordMappings.add(mapping);
  return mapping;
}

/**
 * Persist the server-assigned version for a record — called after a
 * successful push-accept or a successfully-applied pull, so the next push's
 * `parentVersion` is correct.
 */
export async function updateLastServerVersion(
  recordType: RecordType,
  localId: string,
  version: number,
): Promise<void> {
  const existing = await getMappingByLocalId(recordType, localId);
  if (!existing) return;
  await db.recordMappings.update(existing.uuid, { lastServerVersion: version });
}

/**
 * Record (or refresh) a mapping learned from a pulled record: the server's
 * `uuid` now resolves to this device's `localId`. Called for every applied
 * pull (both brand-new records, where the caller has just created the local
 * row and let Dexie mint `localId`, and records this device already knows
 * about — e.g. a self-pushed record round-tripping back — to keep
 * `lastServerVersion` current).
 *
 * `creatorUserId` should be the server's `addedByUser` for the record — the
 * canonical original creator, since this device did not necessarily create
 * the row.
 */
export async function upsertMappingFromPull(
  recordType: RecordType,
  localId: string,
  uuid: string,
  creatorUserId: string,
  version: number,
): Promise<void> {
  const mapping: RecordMapping = {
    recordType,
    localId,
    uuid,
    lastServerVersion: version,
    creatorUserId,
  };
  await db.recordMappings.put(mapping);
}
