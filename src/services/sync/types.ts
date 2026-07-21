// Shared types for the sync engine (Phase 4e, architecture §6.2 + §7.6).

// NOTE: `PendingUpload` lives in `@/db/models` (it's a Dexie table row) — the
// engine imports it from there. Re-exported here for callers that only know
// about this module; do not redeclare it (see WORK_PLAN.md brief B — the two
// copies had drifted before this cleanup).
import type { SyncRecordType } from "@/db/models";
export type { PendingUpload } from "@/db/models";
export type RecordType = SyncRecordType;

// ── Sync cursor ───────────────────────────────────────────────────────────────

/** Per-family pull cursor stored in Dexie. */
export interface SyncCursor {
  /** Primary key = familyId (unique). */
  familyId: string;
  /** Opaque base64url cursor from last pull; undefined before first pull. */
  cursor: string | undefined;
  /** ISO-8601 UTC of last successful pull. */
  updatedAt: string;
}

// ── HTTP request/response shapes (§6.2) ──────────────────────────────────────

export interface PushRecord {
  recordId: string;
  recordType: RecordType;
  blob: string;
  updatedAtMap: Record<string, string>;
  deletedAt?: string;
  parentVersion: number;
  plaintextByteCount: number;
}

export interface PushRequest {
  records: PushRecord[];
}

export interface AcceptedRecord {
  recordId: string;
  version: number;
  familySeq: number;
}

export interface ConflictRecord {
  recordId: string;
  currentBlob: string;
  currentVersion: number;
  currentUpdatedAtMap: Record<string, string>;
  /** The server's current addedByUser/editedByUser — used to build the AAD
   *  meta for decrypting `currentBlob` (never derive these from the local
   *  outbox row, which may have stale/wrong values for a record edited by
   *  someone else). Absent when `currentBlob` is empty (nothing to decrypt). */
  currentAddedByUser?: string;
  currentEditedByUser?: string;
  /** Non-empty when the server's current version of this record is a
   *  tombstone (soft/hard deleted server-side). No blob is meaningful to
   *  decrypt in that case — apply the tombstone locally by identity. */
  currentDeletedAt?: string;
  /** Distinguishes a genuine version conflict ("version") from a synthetic
   *  conflict entry produced when the batch hit the family's storage quota
   *  ("quota") — the client must not treat quota rejections as data
   *  conflicts (no merge, no re-encrypt; the row stays queued for retry). */
  reason?: "version" | "quota";
}

export interface PushResponse {
  accepted: AcceptedRecord[];
  conflicts: ConflictRecord[];
}

export interface PulledRecord {
  recordId: string;
  recordType: string;
  blob: string;
  version: number;
  familySeq: number;
  updatedAtMap: Record<string, string>;
  deletedAt: string | null;
  addedByUser: string;
  editedByUser: string;
}

export interface PullResponse {
  records: PulledRecord[];
  nextCursor: string;
  hasMore: boolean;
}

// ── Raw record (plaintext payload for encrypt/push) ───────────────────────────

export interface RawRecord {
  recordId: string;
  recordType: RecordType;
  familyId: string;
  addedByUserId: string;
  editedByUserId: string;
  updatedAtMap: Record<string, string>;
  deletedAt?: string;
  parentVersion: number;
  /** JSON-serializable payload (the local DB row). */
  payload: unknown;
}
