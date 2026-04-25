// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import Dexie, { type EntityTable } from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { Account, Transaction, Setting } from "./models";

// Point Dexie at fake-indexeddb before any db is opened
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

function makeTestDb() {
  const db = new Dexie("test-db-" + Math.random()) as Dexie & {
    accounts: EntityTable<Account, "id">;
    transactions: EntityTable<Transaction, "id">;
    settings: EntityTable<Setting, "key">;
  };

  db.version(1).stores({
    accounts: "++id, type, name, isTrashed, currency",
    categories: "++id, type, name, isTrashed, displayOrder",
    transactions:
      "++id, date, accountId, categoryId, type, [date+displayOrder], [accountId+date], transferGroupId",
    budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
    exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
    settings: "key",
    backups: "++id, createdAt",
  });

  return db;
}

describe("Database layer", () => {
  let db: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    db = makeTestDb();
  });

  it("can insert and retrieve an account", async () => {
    const now = new Date().toISOString();
    const account: Account = {
      name: "Checking",
      type: "REGULAR",
      color: "oklch(0.7 0.15 200)",
      icon: "wallet",
      currency: "USD",
      description: "",
      balance: 1000,
      startingBalance: 1000,
      includeInTotal: true,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    const id = await db.accounts.add(account);
    const retrieved = await db.accounts.get(id as number);

    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("Checking");
    expect(retrieved!.type).toBe("REGULAR");
    expect(retrieved!.balance).toBe(1000);
    expect(retrieved!.isTrashed).toBe(false);
  });

  it("can insert and retrieve a transaction", async () => {
    const now = new Date().toISOString();
    const tx: Transaction = {
      type: "EXPENSE",
      date: "2026-03-29",
      timestamp: now,
      displayOrder: 0,
      accountId: 1,
      categoryId: 2,
      currency: "USD",
      amount: 50,
      amountMainCurrency: 50,
      exchangeRate: 1,
      note: "Lunch",
      transferGroupId: null,
      transferDirection: null,
      createdAt: now,
      updatedAt: now,
    };

    const id = await db.transactions.add(tx);
    const retrieved = await db.transactions.get(id as number);

    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe("EXPENSE");
    expect(retrieved!.date).toBe("2026-03-29");
    expect(retrieved!.amount).toBe(50);
    expect(retrieved!.note).toBe("Lunch");
  });

  it("compound index [date+displayOrder] works — insert two tx same date, query by date", async () => {
    const now = new Date().toISOString();
    const base: Omit<Transaction, "id" | "displayOrder"> = {
      type: "EXPENSE",
      date: "2026-03-29",
      timestamp: now,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 10,
      amountMainCurrency: 10,
      exchangeRate: 1,
      note: "",
      transferGroupId: null,
      transferDirection: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.transactions.add({ ...base, displayOrder: 0 });
    await db.transactions.add({ ...base, displayOrder: 1 });

    const results = await db.transactions
      .where("[date+displayOrder]")
      .between(["2026-03-29", Dexie.minKey], ["2026-03-29", Dexie.maxKey], true, true)
      .toArray();

    expect(results.length).toBe(2);
    expect(results[0].displayOrder).toBe(0);
    expect(results[1].displayOrder).toBe(1);
  });

  it("settings table uses key as primary key (not auto-increment)", async () => {
    const setting: Setting = { key: "mainCurrency", value: "PLN" };
    await db.settings.put(setting);

    const retrieved = await db.settings.get("mainCurrency");
    expect(retrieved).toBeDefined();
    expect(retrieved!.key).toBe("mainCurrency");
    expect(retrieved!.value).toBe("PLN");

    // Overwrite with put using the same key
    await db.settings.put({ key: "mainCurrency", value: "EUR" });
    const updated = await db.settings.get("mainCurrency");
    expect(updated!.value).toBe("EUR");

    const count = await db.settings.count();
    expect(count).toBe(1);
  });
});
