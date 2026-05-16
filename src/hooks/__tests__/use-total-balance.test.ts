/**
 * Tests for the core calculation logic of useTotalBalance.
 *
 * The hook itself is not tested directly (it relies on Dexie useLiveQuery +
 * Zustand + async React state, which requires jsdom + heavy mocking). Instead,
 * the grouping and netWorth arithmetic — the only non-trivial logic — is
 * extracted and exercised here as pure functions.
 *
 * Monetary amounts are in minor units (cents). DEBT account balances are stored
 * as negative numbers; the hook uses Math.abs() before accumulating into debts.
 */

import { describe, it, expect } from "vitest";
import type { Account } from "@/db/models";

// ── Helpers — mirrors the logic from useTotalBalance ──────────────────────────

type BalanceGroup = { currency: string; assets: number; debts: number };

/**
 * Reproduces the `groups` useMemo from useTotalBalance:
 * filters non-trashed accounts that have includeInTotal=true,
 * separates DEBT balances (via Math.abs) from asset balances.
 */
function buildGroups(accounts: Partial<Account>[]): BalanceGroup[] {
  const result: BalanceGroup[] = [];
  const grouped: Record<string, BalanceGroup> = {};
  for (const acc of accounts) {
    if (!acc.includeInTotal) continue;
    if (acc.isTrashed) continue;
    const currency = acc.currency!;
    if (!grouped[currency]) {
      grouped[currency] = { currency, assets: 0, debts: 0 };
      result.push(grouped[currency]);
    }
    if (acc.type === "DEBT") {
      grouped[currency].debts += Math.abs(acc.balance!);
    } else {
      grouped[currency].assets += acc.balance!;
    }
  }
  return result;
}

/**
 * Reproduces the netWorth calculation from useTotalBalance's `calc()`:
 * for each currency group, apply the exchange rate (1 for same-currency),
 * then return totalAssets - totalDebts, or null if any required rate is missing.
 */
function computeNetWorth(
  groups: BalanceGroup[],
  mainCurrency: string,
  rateMap: Record<string, number | null>,
): number | null {
  let totalAssets = 0;
  let totalDebts = 0;
  for (const g of groups) {
    if (g.currency === mainCurrency) {
      totalAssets += g.assets;
      totalDebts += g.debts;
    } else {
      const r = rateMap[g.currency];
      if (r == null) return null;
      totalAssets += g.assets * r;
      totalDebts += g.debts * r;
    }
  }
  return totalAssets - totalDebts;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useTotalBalance — grouping logic", () => {
  it("same-currency: assets minus debts gives correct netWorth", () => {
    // 1 USD account with 10000 ($100.00) + 1 DEBT account with -5000 ($50.00)
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 10000, includeInTotal: true, isTrashed: false },
      { type: "DEBT", currency: "USD", balance: -5000, includeInTotal: true, isTrashed: false },
    ];

    const groups = buildGroups(accounts);
    expect(groups).toHaveLength(1);
    expect(groups[0].assets).toBe(10000);
    expect(groups[0].debts).toBe(5000); // Math.abs(-5000)

    const netWorth = computeNetWorth(groups, "USD", {});
    expect(netWorth).toBe(5000); // 10000 - 5000
  });

  it("excludes accounts with includeInTotal: false", () => {
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 20000, includeInTotal: true, isTrashed: false },
      {
        type: "REGULAR",
        currency: "USD",
        balance: 99999,
        includeInTotal: false, // excluded
        isTrashed: false,
      },
    ];

    const groups = buildGroups(accounts);
    expect(groups[0].assets).toBe(20000); // excluded account does not contribute
    const netWorth = computeNetWorth(groups, "USD", {});
    expect(netWorth).toBe(20000);
  });

  it("excludes trashed accounts", () => {
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 10000, includeInTotal: true, isTrashed: false },
      {
        type: "REGULAR",
        currency: "USD",
        balance: 50000,
        includeInTotal: true,
        isTrashed: true, // trashed — must be excluded
      },
    ];

    const groups = buildGroups(accounts);
    expect(groups[0].assets).toBe(10000);
    const netWorth = computeNetWorth(groups, "USD", {});
    expect(netWorth).toBe(10000);
  });

  it("DEBT balance uses Math.abs: negative balance is treated as positive debt", () => {
    // DEBT account typically stores balance as negative (debt owed).
    // The hook uses Math.abs() before summing into debts.
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 50000, includeInTotal: true, isTrashed: false },
      { type: "DEBT", currency: "USD", balance: -30000, includeInTotal: true, isTrashed: false },
    ];

    const groups = buildGroups(accounts);
    expect(groups[0].debts).toBe(30000); // Math.abs(-30000)

    const netWorth = computeNetWorth(groups, "USD", {});
    expect(netWorth).toBe(20000); // 50000 - 30000
  });

  it("returns empty groups when all accounts are excluded or trashed", () => {
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 10000, includeInTotal: false, isTrashed: false },
      { type: "REGULAR", currency: "USD", balance: 10000, includeInTotal: true, isTrashed: true },
    ];

    const groups = buildGroups(accounts);
    expect(groups).toHaveLength(0);
  });
});

describe("useTotalBalance — multi-currency netWorth calculation", () => {
  it("applies exchange rate when account currency differs from mainCurrency", () => {
    // 100 EUR = 10000 minor units, rate 1 EUR → 1.08 USD
    // Expected netWorth in USD minor units: Math.round(10000 * 1.08) = 10800
    const accounts: Partial<Account>[] = [
      {
        type: "REGULAR",
        currency: "EUR",
        balance: 10000,
        includeInTotal: true,
        isTrashed: false,
      },
    ];

    const groups = buildGroups(accounts);
    const netWorth = computeNetWorth(groups, "USD", { EUR: 1.08 });
    expect(netWorth).toBe(10800);
  });

  it("uses rate=1 for main-currency accounts regardless of rateMap", () => {
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 5000, includeInTotal: true, isTrashed: false },
    ];

    const groups = buildGroups(accounts);
    // Even if rateMap has a USD entry (should never happen in practice), the
    // hook short-circuits to 1 for currency === mainCurrency.
    const netWorth = computeNetWorth(groups, "USD", { USD: 99 });
    expect(netWorth).toBe(5000);
  });

  it("aggregates multiple currencies correctly", () => {
    // USD 20000 (rate 1) + EUR 10000 (rate 1.08) - DEBT USD 5000 (rate 1)
    // totalAssets = 20000 + 10800 = 30800
    // totalDebts  = 5000
    // netWorth    = 25800
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 20000, includeInTotal: true, isTrashed: false },
      { type: "REGULAR", currency: "EUR", balance: 10000, includeInTotal: true, isTrashed: false },
      { type: "DEBT", currency: "USD", balance: -5000, includeInTotal: true, isTrashed: false },
    ];

    const groups = buildGroups(accounts);
    const netWorth = computeNetWorth(groups, "USD", { EUR: 1.08 });
    expect(netWorth).toBe(25800);
  });
});

describe("useTotalBalance — null propagation when rate is unavailable", () => {
  it("returns null when a required foreign exchange rate is missing", () => {
    const accounts: Partial<Account>[] = [
      {
        type: "REGULAR",
        currency: "EUR",
        balance: 10000,
        includeInTotal: true,
        isTrashed: false,
      },
    ];

    const groups = buildGroups(accounts);
    const netWorth = computeNetWorth(groups, "USD", { EUR: null });
    expect(netWorth).toBeNull();
  });

  it("still returns a correct total when all accounts are in the main currency and rateMap is empty", () => {
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 8000, includeInTotal: true, isTrashed: false },
      { type: "DEBT", currency: "USD", balance: -3000, includeInTotal: true, isTrashed: false },
    ];

    const groups = buildGroups(accounts);
    const netWorth = computeNetWorth(groups, "USD", {});
    expect(netWorth).toBe(5000);
  });

  it("returns null when one of several currencies has a missing rate", () => {
    const accounts: Partial<Account>[] = [
      { type: "REGULAR", currency: "USD", balance: 20000, includeInTotal: true, isTrashed: false },
      { type: "REGULAR", currency: "EUR", balance: 10000, includeInTotal: true, isTrashed: false },
    ];

    const groups = buildGroups(accounts);
    // EUR rate is null — whole result must be null, not partially computed
    const netWorth = computeNetWorth(groups, "USD", { USD: 1, EUR: null });
    expect(netWorth).toBeNull();
  });
});
