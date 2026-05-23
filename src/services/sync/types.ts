// Shared types for the sync engine (Phase 4e, architecture §6.2 + §7.6).

export type RecordType = "transaction" | "account" | "category" | "budget" | "settings";

// ── Outbox (pending uploads) ──────────────────────────────────────────────────

/** A record waiting to be pushed to the server. */
export interface PendingUpload {
  /** Auto-incremented primary key. */
  id?: number;
  /** UUIDv7 stable across retries. */
  recordId: string;
  recordType: RecordType;
  /** base64url encoded blob. */
  blob: string;
  updatedAtMap: Record<string, string>;
  deletedAt?: string;
  parentVersion: number;
  plaintextByteCount: number;
  /** Number of failed push attempts (excluding conflicts). */
  attempts: number;
  /** ISO-8601 UTC; null if not yet failed. */
  lastFailedAt: string | null;
  /** familyId associated with this record (for key lookup). */
  familyId: string;
}

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
