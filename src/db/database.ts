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

// v6 — main-thread Dexie no longer references `cipherKeys`; raw key material
// lives in a worker-only IndexedDB (`expenses-app-keys`). The table itself is
// kept in the schema (Dexie requires all prior stores to be re-declared) so the
// worker can migrate any pre-existing rows on first run after deploy. Reads /
// writes from the main thread are removed (see B5d). Once the worker has
// migrated the rows it clears the legacy store; the table definition can be
// dropped in a future v7 migration.
db.version(6).stores({
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
