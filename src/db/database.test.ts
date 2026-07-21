// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import type { Account, Transaction, Setting } from "./models";

const EXPECTED_TABLES = [
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "exchangeRates",
  "settings",
  "backups",
  "logs",
  "pendingUploads",
  "syncCursors",
  "recordMappings",
] as const;

describe("Database layer", () => {
  beforeEach(async () => {
    await db.accounts.clear();
    await db.transactions.clear();
    await db.settings.clear();
  });

  it("opens successfully at the current schema version", async () => {
    await db.open();
    expect(db.isOpen()).toBe(true);
    expect(db.verno).toBeGreaterThanOrEqual(9);
  });

  it("pendingUploads store indexes recordId (used by enqueuePush coalescing)", () => {
    const pendingUploads = db.table("pendingUploads");
    const indexNames = pendingUploads.schema.indexes.map((i) => i.name);
    expect(indexNames).toContain("recordId");
  });

  it("declares every expected table", () => {
    const tableNames = db.tables.map((t) => t.name);
    for (const name of EXPECTED_TABLES) {
      expect(tableNames).toContain(name);
    }
  });

  it("transactions store indexes transferGroupId (used by transfer revert/lookup)", () => {
    const transactions = db.table("transactions");
    const indexNames = transactions.schema.indexes.map((i) => i.name);
    expect(indexNames).toContain("transferGroupId");
  });

  it("categories store indexes displayOrder (used by drag-reorder sort)", () => {
    const categories = db.table("categories");
    const indexNames = categories.schema.indexes.map((i) => i.name);
    expect(indexNames).toContain("displayOrder");
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

  it("date index supports a range query (used by useTransactions)", async () => {
    const now = new Date().toISOString();
    const base: Omit<Transaction, "id"> = {
      type: "EXPENSE",
      date: "2026-03-29",
      timestamp: now,
      displayOrder: 0,
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
    await db.transactions.add({ ...base, date: "2026-03-30", displayOrder: 1 });

    const results = await db.transactions
      .where("date")
      .between("2026-03-29", "2026-03-30", true, true)
      .toArray();

    expect(results.length).toBe(2);
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
