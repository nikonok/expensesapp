// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLegacyColor } from "./database";
import { COLOR_PALETTE, PRIMARY_ACCENT_COLOR } from "../utils/constants";

describe("resolveLegacyColor", () => {
  it("maps var(--swatch-N) to the matching literal oklch value", () => {
    const swatch5 = COLOR_PALETTE.find((s) => s.id === 5)!;
    expect(resolveLegacyColor("var(--swatch-5)")).toBe(swatch5.value);
  });

  it("maps var(--color-primary) to the literal primary accent oklch value", () => {
    expect(resolveLegacyColor("var(--color-primary)")).toBe(PRIMARY_ACCENT_COLOR);
  });

  it("returns null for an already-literal oklch value (nothing to migrate)", () => {
    expect(resolveLegacyColor("oklch(65% 0.22 30)")).toBeNull();
  });

  it("returns null for an unknown swatch id", () => {
    expect(resolveLegacyColor("var(--swatch-999)")).toBeNull();
  });

  it("returns null for an unrelated string", () => {
    expect(resolveLegacyColor("#ff0000")).toBeNull();
  });
});

describe("v7 upgrade — normalizes legacy colors in-place", () => {
  const DB_NAME = "expenses-app-db-color-migration-test";

  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it("rewrites var(--swatch-N) and var(--color-primary) colors on existing rows", async () => {
    // Seed a v6-shaped database (mirrors src/db/database.ts's v6 block) with
    // legacy CSS-var colors, exactly as they could exist on a real device
    // pre-dating the accountSchema/categorySchema literal-oklch requirement.
    const legacyDb = new Dexie(DB_NAME);
    legacyDb.version(6).stores({
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
    await legacyDb.open();

    const now = new Date().toISOString();
    const accountId = await legacyDb.table("accounts").add({
      name: "Cash",
      type: "REGULAR",
      color: "var(--color-primary)",
      icon: "wallet",
      currency: "USD",
      description: "",
      balance: 0,
      startingBalance: 0,
      includeInTotal: true,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    });
    const categoryId = await legacyDb.table("categories").add({
      name: "Food",
      type: "EXPENSE",
      color: "var(--swatch-5)",
      icon: "utensils",
      displayOrder: 0,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    });
    const literalCategoryId = await legacyDb.table("categories").add({
      name: "Already migrated",
      type: "EXPENSE",
      color: "oklch(65% 0.22 30)",
      icon: "car",
      displayOrder: 1,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    });
    legacyDb.close();

    // Reopen the same physical database, this time declaring v7 exactly as
    // src/db/database.ts does, which triggers the color-normalizing upgrade.
    const upgradedDb = new Dexie(DB_NAME);
    upgradedDb.version(6).stores({
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
    upgradedDb
      .version(7)
      .stores({
        accounts: "++id, type",
        categories: "++id, type, displayOrder",
        transactions: "++id, date, accountId, categoryId, type, transferGroupId",
        budgets: "++id, categoryId, accountId, month, [categoryId+month], [accountId+month]",
        exchangeRates: "++id, baseCurrency, &[baseCurrency+date]",
        settings: "key",
        backups: "++id, createdAt",
        logs: "++id, timestamp, level",
        cipherKeys: "name",
        pendingUploads: "++id",
        syncCursors: "&familyId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("accounts")
          .toCollection()
          .modify((account) => {
            const resolved = resolveLegacyColor(account.color);
            if (resolved) account.color = resolved;
          });
        await tx
          .table("categories")
          .toCollection()
          .modify((category) => {
            const resolved = resolveLegacyColor(category.color);
            if (resolved) category.color = resolved;
          });
      });
    await upgradedDb.open();

    const account = await upgradedDb.table("accounts").get(accountId);
    const category = await upgradedDb.table("categories").get(categoryId);
    const literalCategory = await upgradedDb.table("categories").get(literalCategoryId);

    expect(account.color).toBe(PRIMARY_ACCENT_COLOR);
    expect(category.color).toBe(COLOR_PALETTE.find((s) => s.id === 5)!.value);
    // Already-literal colors are left untouched.
    expect(literalCategory.color).toBe("oklch(65% 0.22 30)");

    upgradedDb.close();
  });
});
