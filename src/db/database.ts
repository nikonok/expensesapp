import Dexie, { type EntityTable } from "dexie";
import type {
  Account,
  Category,
  Transaction,
  Budget,
  ExchangeRateCache,
  Setting,
  Backup,
} from "./models";

const db = new Dexie("expenses-app-db") as Dexie & {
  accounts: EntityTable<Account, "id">;
  categories: EntityTable<Category, "id">;
  transactions: EntityTable<Transaction, "id">;
  budgets: EntityTable<Budget, "id">;
  exchangeRates: EntityTable<ExchangeRateCache, "id">;
  settings: EntityTable<Setting, "key">;
  backups: EntityTable<Backup, "id">;
};

db.version(1).stores({
  accounts: "++id, type, name, isTrashed, currency",
  categories: "++id, type, name, isTrashed, displayOrder",
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId",
  budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
  exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
  settings: "key",
  backups: "++id, createdAt",
});

db.version(2).stores({
  transactions:
    "++id, date, accountId, categoryId, type, isTrashed, [date+displayOrder], [accountId+date], transferGroupId, toAccountId",
});

db.version(3).stores({}); // added debtOriginalAmount to Account (non-indexed field, no schema change needed)

db.version(4)
  .stores({})
  .upgrade(async (trans) => {
    await trans.table("accounts").clear();
    await trans.table("transactions").clear();
    await trans.table("budgets").clear();
  });

db.version(5).stores({}); // added isOverpayment to Transaction (non-indexed field)

export { db };
