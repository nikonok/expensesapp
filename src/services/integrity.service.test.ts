import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/database";
import type { Account, Transaction } from "@/db/models";
import { checkDatabaseIntegrity } from "./integrity.service";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Checking",
    type: "REGULAR",
    color: "oklch(70% 0.2 180)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 0,
    startingBalance: 0,
    includeInTotal: true,
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: "EXPENSE",
    date: "2026-01-01",
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId: 1,
    categoryId: null,
    currency: "USD",
    amount: 100,
    amountMainCurrency: 100,
    exchangeRate: 1,
    note: "",
    transferGroupId: null,
    transferDirection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("checkDatabaseIntegrity", () => {
  it("returns { ok: true } when all tables are empty but readable", async () => {
    const result = await checkDatabaseIntegrity();
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: true } when tables contain data", async () => {
    await db.accounts.add({
      name: "Test Account",
      type: "REGULAR",
      color: "oklch(0.7 0.2 180)",
      icon: "wallet",
      currency: "USD",
      description: "",
      balance: 1000,
      startingBalance: 1000,
      includeInTotal: true,
      isTrashed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await checkDatabaseIntegrity();
    expect(result).toEqual({ ok: true });

    await db.accounts.clear();
  });

  it("returns { ok: false } with an error string when a table read throws", async () => {
    const fakeCollection = {
      toArray: () => Promise.reject(new Error("IndexedDB read failure")),
    };
    const spy = vi.spyOn(db.accounts, "limit").mockReturnValue(fakeCollection as never);

    const result = await checkDatabaseIntegrity();

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);

    spy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe("checkDatabaseIntegrity — semantic checks", () => {
  afterEach(async () => {
    await db.accounts.clear();
    await db.transactions.clear();
    vi.restoreAllMocks();
  });

  it("returns { ok: true } for a complete transfer pair (2 legs)", async () => {
    const accountId = await db.accounts.add(makeAccount());
    await db.transactions.add(
      makeTransaction({
        accountId: accountId as number,
        type: "TRANSFER",
        transferGroupId: "group-1",
        transferDirection: "OUT",
      }),
    );
    await db.transactions.add(
      makeTransaction({
        accountId: accountId as number,
        type: "TRANSFER",
        transferGroupId: "group-1",
        transferDirection: "IN",
      }),
    );

    const result = await checkDatabaseIntegrity();
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false with failureKind orphaned-transfer for a dangling transfer leg", async () => {
    const accountId = await db.accounts.add(makeAccount());
    await db.transactions.add(
      makeTransaction({
        accountId: accountId as number,
        type: "TRANSFER",
        transferGroupId: "group-orphaned",
        transferDirection: "OUT",
      }),
    );

    const result = await checkDatabaseIntegrity();
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("orphaned-transfer");
  });

  it("returns ok: false with failureKind orphaned-account-ref when a transaction references a missing account", async () => {
    await db.transactions.add(makeTransaction({ accountId: 999999 }));

    const result = await checkDatabaseIntegrity();
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("orphaned-account-ref");
  });
});
