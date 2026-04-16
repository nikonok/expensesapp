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

export { db };
