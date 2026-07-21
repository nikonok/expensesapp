/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TransactionRow from "./TransactionRow";
import type { Account, Category, Transaction } from "../../db/models";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
}));

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Wallet",
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
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    type: "EXPENSE",
    date: "2026-01-01",
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId: 1,
    categoryId: 1,
    currency: "USD",
    amount: 1050,
    amountMainCurrency: 1050,
    exchangeRate: 1,
    note: "",
    transferGroupId: null,
    transferDirection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const category: Category = {
  id: 1,
  name: "Groceries",
  type: "EXPENSE",
  color: "oklch(0.7 0.2 30)",
  icon: "shopping-cart",
  displayOrder: 0,
  isTrashed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("TransactionRow", () => {
  it("renders the amount in the transaction's stored currency, not the account's current currency", () => {
    // Account currency has since changed to EUR, but the transaction was
    // recorded in USD — the amount must render using USD (tx.currency).
    const account = makeAccount({ currency: "EUR" });
    const transaction = makeTransaction({ currency: "USD", amount: 1050 });

    render(
      <TransactionRow
        transaction={transaction}
        account={account}
        category={category}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/expense/i).textContent).toContain("$");
    expect(screen.getByLabelText(/expense/i).textContent).not.toContain("€");
  });
});
