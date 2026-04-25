/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CategoryBreakdown from "./CategoryBreakdown";
import type { Category } from "../../db/models";
import type { Account } from "../../db/models";
import type { Transaction } from "../../db/models";

// ── Dependency mocks ─────────────────────────────────────────────────────────

vi.mock("../../hooks/use-categories", () => ({
  useCategories: vi.fn(() => []),
}));

vi.mock("../../hooks/use-accounts", () => ({
  useAccounts: vi.fn(() => []),
}));

vi.mock("../shared/IconPicker", () => ({ getLucideIcon: () => null }));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { useCategories } from "../../hooks/use-categories";
import { useAccounts } from "../../hooks/use-accounts";

const mockUseCategories = vi.mocked(useCategories);
const mockUseAccounts = vi.mocked(useAccounts);

// ── Factory helpers ──────────────────────────────────────────────────────────

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name: "Food",
    type: "EXPENSE",
    color: "oklch(72% 0.22 30)",
    icon: "utensils",
    displayOrder: 0,
    isTrashed: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    type: "EXPENSE",
    date: "2026-04-01",
    timestamp: "2026-04-01T12:00:00Z",
    displayOrder: 0,
    accountId: 1,
    categoryId: 1,
    currency: "USD",
    amount: 10000,
    amountMainCurrency: 10000,
    exchangeRate: 1,
    note: "",
    isTrashed: false,
    transferGroupId: null,
    transferDirection: null,
    toAccountId: null,
    interestAmount: null,
    principalAmount: null,
    recurringRule: null,
    createdAt: "2026-04-01T12:00:00Z",
    updatedAt: "2026-04-01T12:00:00Z",
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 10,
    name: "Car Loan",
    type: "DEBT",
    color: "oklch(72% 0.22 210)",
    icon: "car",
    currency: "USD",
    description: "",
    balance: -500000,
    startingBalance: -1000000,
    includeInTotal: true,
    isTrashed: false,
    savingsGoal: null,
    savingsInterestRate: null,
    debtOriginalAmount: null,
    mortgageLoanAmount: null,
    mortgageStartDate: null,
    mortgageTermYears: null,
    mortgageInterestRate: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CategoryBreakdown", () => {
  it("renders nothing when there are no rows", () => {
    mockUseCategories.mockReturnValue([]);
    mockUseAccounts.mockReturnValue([]);

    const { container } = render(<CategoryBreakdown transactions={[]} currency="USD" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders active categories with spend", () => {
    mockUseCategories.mockReturnValue([
      makeCategory({ id: 1, name: "Food" }),
      makeCategory({ id: 2, name: "Transport", icon: "bus" }),
    ]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [
      makeTransaction({ id: 1, categoryId: 1, amountMainCurrency: 5000 }),
      makeTransaction({ id: 2, categoryId: 1, amountMainCurrency: 3000 }),
      makeTransaction({ id: 3, categoryId: 2, amountMainCurrency: 2000 }),
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();
    // amounts: Food = 80 USD, Transport = 20 USD
    expect(screen.getByText("$80.00")).toBeTruthy();
    expect(screen.getByText("$20.00")).toBeTruthy();
  });

  it("renders archived (trashed) categories with spend — core regression test", () => {
    mockUseCategories.mockReturnValue([
      makeCategory({ id: 1, name: "Food", isTrashed: false }),
      makeCategory({ id: 2, name: "Dining", isTrashed: true }),
    ]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [
      makeTransaction({ id: 1, categoryId: 1, amountMainCurrency: 5000 }),
      makeTransaction({ id: 2, categoryId: 2, amountMainCurrency: 7500 }),
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("Dining")).toBeTruthy();
    // Dining's amount must be rendered (not zero/dash)
    expect(screen.getByText("$75.00")).toBeTruthy();
    // No visual "(archived)" marker
    expect(screen.queryByText(/(archived)/i)).toBeNull();
  });

  it("archived category with zero spend is NOT shown in breakdown", () => {
    mockUseCategories.mockReturnValue([
      makeCategory({ id: 1, name: "Food", isTrashed: false }),
      makeCategory({ id: 2, name: "OldCategory", isTrashed: true }),
    ]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [makeTransaction({ id: 1, categoryId: 1, amountMainCurrency: 10000 })];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    // OldCategory is archived with zero spend — should NOT appear
    expect(screen.queryByText("OldCategory")).toBeNull();
    // Food still appears
    expect(screen.getByText("Food")).toBeTruthy();
  });

  it("active category with zero spend appears in breakdown", () => {
    mockUseCategories.mockReturnValue([
      makeCategory({ id: 1, name: "Food", isTrashed: false }),
      makeCategory({ id: 2, name: "Entertainment", isTrashed: false }),
    ]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [
      makeTransaction({ id: 1, categoryId: 1, amountMainCurrency: 10000 }),
      // Entertainment has zero spend this period
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    // Entertainment is active with zero spend — should still appear
    expect(screen.getByText("Entertainment")).toBeTruthy();
    // Zero-spend rows show a dash instead of an amount
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("sorts rows: with-spend descending, zero-spend alphabetically", () => {
    mockUseCategories.mockReturnValue([
      makeCategory({ id: 1, name: "Aaa" }),
      makeCategory({ id: 2, name: "Bbb" }),
      makeCategory({ id: 3, name: "Ccc" }),
    ]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [
      makeTransaction({ id: 1, categoryId: 2, amountMainCurrency: 20000 }),
      makeTransaction({ id: 2, categoryId: 3, amountMainCurrency: 10000 }),
      // Aaa has zero spend
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    const names = screen.getAllByText(/^(Aaa|Bbb|Ccc)$/).map((el) => el.textContent);
    const bbbIdx = names.indexOf("Bbb");
    const cccIdx = names.indexOf("Ccc");
    const aaaIdx = names.indexOf("Aaa");

    expect(bbbIdx).toBeLessThan(cccIdx);
    expect(cccIdx).toBeLessThan(aaaIdx);
  });

  it("debt payment account rows appear alongside category rows", () => {
    mockUseCategories.mockReturnValue([makeCategory({ id: 1, name: "Food" })]);
    mockUseAccounts.mockReturnValue([makeAccount({ id: 10, name: "Car Loan", type: "DEBT" })]);

    const transactions = [
      makeTransaction({ id: 1, type: "EXPENSE", categoryId: 1, amountMainCurrency: 5000 }),
      makeTransaction({
        id: 2,
        type: "TRANSFER",
        categoryId: null,
        transferDirection: "OUT",
        toAccountId: 10,
        amountMainCurrency: 20000,
        transferGroupId: "abc-123",
      }),
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("Car Loan")).toBeTruthy();
  });

  it("debt account row omitted when account missing from array", () => {
    mockUseCategories.mockReturnValue([]);
    mockUseAccounts.mockReturnValue([]); // no accounts resolved

    const transactions = [
      makeTransaction({
        id: 1,
        type: "TRANSFER",
        categoryId: null,
        transferDirection: "OUT",
        toAccountId: 10,
        amountMainCurrency: 20000,
        transferGroupId: "abc-123",
      }),
    ];

    const { container } = render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    // Component returns null when rows.length === 0 (account row is skipped, no category rows)
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Car Loan")).toBeNull();
  });

  it("transactions with unknown categoryId are silently excluded", () => {
    mockUseCategories.mockReturnValue([makeCategory({ id: 1, name: "Food" })]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [
      makeTransaction({ id: 1, categoryId: 1, amountMainCurrency: 5000 }),
      makeTransaction({ id: 2, categoryId: 999, amountMainCurrency: 30000 }),
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    expect(screen.getByText("Food")).toBeTruthy();
    // Only Food (50) should appear — unknown category 999 is excluded from display
    // Total spend = 50 + 300 (both are tallied in totalsMap but 999 has no row)
    // Food shows its amount
    expect(screen.getByText("$50.00")).toBeTruthy();
    // No row for the unknown category
    expect(screen.queryByText("$300.00")).toBeNull();
  });

  it("percentage calculation is correct", () => {
    mockUseCategories.mockReturnValue([
      makeCategory({ id: 1, name: "Alpha" }),
      makeCategory({ id: 2, name: "Beta" }),
    ]);
    mockUseAccounts.mockReturnValue([]);

    const transactions = [
      makeTransaction({ id: 1, categoryId: 1, amountMainCurrency: 7500 }),
      makeTransaction({ id: 2, categoryId: 2, amountMainCurrency: 2500 }),
    ];

    render(<CategoryBreakdown transactions={transactions} currency="USD" />);

    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });
});
