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

export { db };
