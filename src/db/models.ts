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
// - "lastUsedAccountId"      : number | null
// - "autoBackupIntervalHours": number | null (null = disabled)
// - "lastAutoBackupAt"       : string | null (ISO-8601 UTC)
// - "hasCompletedOnboarding" : boolean (default false)

// ── Backups ──

export interface Backup {
  id?: number;
  createdAt: string; // ISO-8601 UTC
  data: string; // JSON-serialized full database snapshot
  isAutomatic: boolean; // true if created by scheduled backup
}

// ── Logs ──

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface Log {
  id?: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown> | null;
}
