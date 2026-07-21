// ── Accounts ──

export type AccountType = "REGULAR" | "DEBT" | "SAVINGS";

export interface Account {
  id?: number;
  name: string; // max 64 chars
  type: AccountType;
  color: string; // oklch value from shared palette
  icon: string; // Lucide icon name or emoji
  currency: string; // ISO 4217 code (e.g. "PLN", "USD")
  description: string; // max 255 chars
  balance: number; // current stored balance (updated on tx add/edit/delete/manual adjust)
  startingBalance: number; // initial balance at creation (informational, never changes)
  includeInTotal: boolean; // include in total balance / Total Wealth
  isTrashed: boolean; // soft delete

  // Savings-specific
  savingsGoal?: number | null; // optional target amount
  savingsInterestRate?: number | null; // future feature stub: annual interest rate as decimal

  // Debt-specific
  debtOriginalAmount?: number | null; // total debt at inception; used for payoff progress bar
  mortgageLoanAmount?: number | null;
  mortgageStartDate?: string | null; // ISO-8601
  mortgageTermYears?: number | null;
  mortgageInterestRate?: number | null; // stored as decimal

  // Future feature stub
  autoAccrueInterest?: boolean; // debt auto-interest accrual (not implemented)

  createdAt: string; // ISO-8601 UTC
  updatedAt: string; // ISO-8601 UTC
}

// ── Categories ──

export type CategoryType = "EXPENSE" | "INCOME";

export interface Category {
  id?: number;
  name: string; // max 64 chars
  type: CategoryType; // immutable after creation
  color: string; // oklch value from shared palette
  icon: string; // Lucide icon name or emoji
  displayOrder: number; // drag-reorder position; lower = first
  isTrashed: boolean; // soft delete

  createdAt: string;
  updatedAt: string;
}

// ── Transactions ──

export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER";

export interface Transaction {
  id?: number;
  type: TransactionType;
  date: string; // local date as "YYYY-MM-DD" (wall-clock date at entry time)
  timestamp: string; // full ISO-8601 UTC (creation moment, for ordering within a day)
  displayOrder: number; // user-reorderable position within the day; lower = first

  accountId: number; // FK to accounts.id
  categoryId: number | null; // FK to categories.id; null for transfers

  currency: string; // ISO 4217 — account's currency AT THE TIME of transaction creation

  amount: number; // in account's currency; always positive
  amountMainCurrency: number; // converted to main currency; always positive
  exchangeRate: number; // rate used: 1 unit of account currency = X main currency

  note: string; // max 255 chars
  isTrashed?: boolean; // soft delete (default false)

  // Transfer-specific
  transferGroupId: string | null; // shared UUID linking the two halves of a transfer
  transferDirection: "OUT" | "IN" | null; // OUT = source, IN = destination

  // Debt payment metadata (set on TRANSFER OUT leg only when destination is a DEBT account)
  toAccountId?: number | null; // FK to accounts.id — destination DEBT account
  interestAmount?: number | null; // informational: interest portion of regular payment
  principalAmount?: number | null; // informational: principal portion of regular payment
  isOverpayment?: boolean | null;

  // Future feature stub
  recurringRule?: {
    frequency: "daily" | "weekly" | "monthly" | "yearly";
    endDate?: string; // ISO-8601, optional
  } | null;

  createdAt: string;
  updatedAt: string;
}

// ── Budgets ──

export interface Budget {
  id?: number;
  categoryId: number | null; // FK to categories.id; null when budget is for an account
  accountId: number | null; // FK to accounts.id (DEBT or SAVINGS only); null when budget is for a category
  month: string; // "YYYY-MM" format
  plannedAmount: number; // positive number

  createdAt: string;
  updatedAt: string;
}

// ── Exchange Rate Cache ──

export interface ExchangeRateCache {
  id?: number;
  baseCurrency: string; // ISO 4217
  date: string; // "YYYY-MM-DD"
  rates: Record<string, number>; // { "EUR": 0.85, "GBP": 0.73, ... }
  fetchedAt: string; // ISO-8601 UTC
}

// ── Settings (key-value) ──

export interface Setting {
  key: string; // primary key
  value: unknown; // JSON-serializable value
}

// Predefined setting keys:
// - "mainCurrency"           : string (ISO 4217, default "USD")
// - "language"               : string (default "en")
// - "startupScreen"          : string (tab name, default "transactions")
// - "notificationEnabled"    : boolean (default false)
// - "notificationTime"       : string ("HH:MM", default "20:00")
// - "hapticFeedbackEnabled"  : boolean (default false)
// - "lastUsedAccountId"      : number | null
// - "autoBackupIntervalHours": number | null (null = disabled)
// - "lastAutoBackupAt"       : string | null (ISO-8601 UTC)
// - "hasCompletedOnboarding" : boolean (default false)
// - "logLevel"               : "all" | "errors" (default "errors")
// - "pushSubscriptionId"     : string | null — backend-issued Web Push subscription id

// ── Backups ──

export interface Backup {
  id?: number;
  createdAt: string; // ISO-8601 UTC
  data: string; // JSON-serialized full database snapshot
  isAutomatic: boolean; // true if created by scheduled backup
}

// ── Logs ──

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface Log {
  id?: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown> | null;
}

// ── Cipher Keys (Phase 3 — device key material, architecture §9.2) ──

export interface CipherKey {
  name: string; // primary key, e.g. "familyKey", "devicePrivKey", "devicePubKey"
  value: Uint8Array; // raw key bytes
  createdAt: string; // ISO-8601 UTC
}

// ── Sync outbox (Phase 4e — pending record uploads) ──────────────────────────

export type SyncRecordType = "transaction" | "account" | "category" | "budget" | "settings";

/** A record queued in the local outbox, waiting to be pushed to the backend. */
export interface PendingUpload {
  /** Auto-incremented primary key. */
  id?: number;
  /** UUIDv7 — stable across retry attempts for the same logical write. */
  recordId: string;
  recordType: SyncRecordType;
  /** base64url-encoded encrypted blob. */
  blob: string;
  updatedAtMap: Record<string, string>;
  deletedAt?: string;
  /** 0 for new records; last-seen server version for updates. */
  parentVersion: number;
  plaintextByteCount: number;
  /** Number of failed push attempts (non-conflict 4xx errors). */
  attempts: number;
  /** ISO-8601 UTC of last failure; null if never failed. */
  lastFailedAt: string | null;
  /** familyId for key-lookup during re-encryption on conflict merge. */
  familyId: string;
  /** ID of the user who originally created this record (carried in AAD). */
  addedByUserId?: string;
  /** ID of the user who produced this edit (carried in AAD). */
  editedByUserId?: string;
  /** B8 — set when the server rejected the upload with a terminal status (e.g.
   *  HTTP 413 quota exceeded). Flush attempts skip terminal rows; the UI
   *  surfaces them via `useSyncStore.lastError = "quota-exceeded"`. */
  terminal?: boolean;
}

// ── Sync cursors (Phase 4e — per-family pull position) ───────────────────────

/** Stores the opaque pull cursor returned by the backend per family. */
export interface SyncCursor {
  /** Primary key = familyId (unique index &familyId). */
  familyId: string;
  /** Opaque base64url cursor from the last successful pull response. */
  cursor: string | undefined;
  /** ISO-8601 UTC of when this cursor was last updated. */
  updatedAt: string;
}

// ── Record mappings (v8 — canonical local↔server record identity) ───────────

/**
 * Maps a local Dexie row to its server-facing UUID identity. This is the
 * ONE canonical mapping table shared by the live sync engine (`services/sync/`)
 * and the solo→family migration path (`services/family/migrate.ts`).
 *
 * `localId` is `String(dexie auto-increment id)` for transactions/accounts/
 * categories/budgets, or the settings key string for `recordType: "settings"`
 * (settings keys are already stable strings — no id-collision risk there).
 *
 * Primary key is the compound `[recordType+localId]`; `uuid` is separately
 * unique-indexed so the pull path can translate server recordId → local row.
 */
export interface RecordMapping {
  recordType: SyncRecordType;
  /** Local identity: `String(id)` for domain tables, or the raw settings key. */
  localId: string;
  /** Server-facing UUID identity (the wire `recordId`). Stable for the life of the row. */
  uuid: string;
  /** Last server `version` seen for this record (via push-accept or pull); 0 if never synced. */
  lastServerVersion: number;
  /** userId of the record's ORIGINAL creator — preserved across edits by other users/devices. */
  creatorUserId: string;
}
