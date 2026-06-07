import Dexie, { type EntityTable } from "dexie";
import type {
  Account,
  Category,
  Transaction,
  Budget,
  ExchangeRateCache,
  Setting,
  Backup,
  Log,
  CipherKey,
  PendingUpload,
  SyncCursor,
} from "./models";

const db = new Dexie("expenses-app-db") as Dexie & {
  accounts: EntityTable<Account, "id">;
  categories: EntityTable<Category, "id">;
  transactions: EntityTable<Transaction, "id">;
  budgets: EntityTable<Budget, "id">;
  exchangeRates: EntityTable<ExchangeRateCache, "id">;
  settings: EntityTable<Setting, "key">;
  backups: EntityTable<Backup, "id">;
  logs: EntityTable<Log, "id">;
  cipherKeys: EntityTable<CipherKey, "name">;
  pendingUploads: EntityTable<PendingUpload, "id">;
  syncCursors: EntityTable<SyncCursor, "familyId">;
};

// v1 — initial release schema (all development migrations collapsed)
db.version(1).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
});

// v2 — add logs table
db.version(2).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
});

// v3 — add cipherKeys table for device key material (Phase 3, architecture §9.2)
db.version(3).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
});

// v4 — add sync outbox + cursor tables (Phase 4e, architecture §6.2)
db.version(4).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id, recordId, attempts",
  syncCursors: "&familyId",
});

// v5 — extend pendingUploads with editor IDs (no new indexes; field-only change).
// Dexie still requires re-declaring the full schema in the new version block.
db.version(5).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
  logs: "++id, timestamp, level",
  cipherKeys: "name",
  pendingUploads: "++id, recordId, attempts",
  syncCursors: "&familyId",
});

export { db };
