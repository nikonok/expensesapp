/* @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Transaction, Account, Category } from "../../db/models";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockShowToast,
  mockRevertTransaction,
  mockRevertTransfer,
  MockQuotaError,
  mockDbTransactionsWhere,
} = vi.hoisted(() => {
  class MockQuotaError extends Error {
    name = "QuotaError";
  }
  return {
    mockShowToast: vi.fn(),
    mockRevertTransaction: vi.fn(),
    mockRevertTransfer: vi.fn(),
    MockQuotaError,
    mockDbTransactionsWhere: vi.fn(),
  };
});

let mockTransactions: Transaction[] = [];
vi.mock("../../hooks/use-transactions", () => ({
  useTransactions: () => mockTransactions,
}));

const mockAccounts: Account[] = [
  {
    id: 1,
    name: "Checking",
    type: "REGULAR",
    color: "oklch(72% 0.22 210)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 100000,
    startingBalance: 0,
    includeInTotal: true,
    isTrashed: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Savings",
    type: "REGULAR",
    color: "oklch(72% 0.22 210)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 50000,
    startingBalance: 0,
    includeInTotal: true,
    isTrashed: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];
vi.mock("../../hooks/use-accounts", () => ({ useAccounts: () => mockAccounts }));

const mockCategories: Category[] = [];
vi.mock("../../hooks/use-categories", () => ({ useCategories: () => mockCategories }));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: (sel: (s: { mainCurrency: string }) => unknown) => sel({ mainCurrency: "USD" }),
}));

vi.mock("../shared/Toast", () => ({
  useToast: () => ({ show: mockShowToast }),
}));

vi.mock("../../services/balance.service", () => ({
  revertTransaction: (...args: unknown[]) => mockRevertTransaction(...args),
  revertTransfer: (...args: unknown[]) => mockRevertTransfer(...args),
  QuotaError: MockQuotaError,
}));

vi.mock("../../services/sync/push-helpers", () => ({
  pushTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../db/database", () => ({
  db: {
    transactions: {
      where: (...args: unknown[]) => mockDbTransactionsWhere(...args),
      bulkPut: vi.fn().mockResolvedValue(undefined),
    },
    transaction: (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
  },
}));

vi.mock("../shared/PeriodFilter", () => ({ default: () => null }));
vi.mock("./TransactionFilters", () => ({ default: () => null }));
vi.mock("./TransactionDayHeader", () => ({ default: () => null }));

import TransactionList from "./TransactionList";
import { useUIStore } from "../../stores/ui-store";

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    type: "EXPENSE",
    date: "2026-01-01",
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId: 1,
    categoryId: null,
    currency: "USD",
    amount: 1000,
    amountMainCurrency: 1000,
    exchangeRate: 1,
    note: "",
    transferGroupId: null,
    transferDirection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderList() {
  return render(
    <MemoryRouter>
      <TransactionList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransactions = [];
  useUIStore.getState().clearSelection();
  useUIStore.setState({
    transactionAccountFilter: null,
    transactionCategoryFilter: null,
    transactionNoteFilter: "",
  });
});

describe("TransactionList — handleEdit resolves the OUT leg from the DB", () => {
  it("navigates using the OUT leg id even when only the IN leg is in the (filtered) transactions list", async () => {
    const groupId = "transfer-group-1";
    const inLeg = makeTx({
      id: 20,
      type: "TRANSFER",
      transferGroupId: groupId,
      transferDirection: "IN",
      accountId: 2,
    });
    // Simulate an active account filter: only the IN leg is present in the
    // hook's filtered `transactions` array — the OUT leg (id 21) must still
    // be resolved via a direct DB query, not from this array.
    mockTransactions = [inLeg];

    mockDbTransactionsWhere.mockReturnValue({
      equals: () => ({
        toArray: () =>
          Promise.resolve([
            inLeg,
            makeTx({
              id: 21,
              type: "TRANSFER",
              transferGroupId: groupId,
              transferDirection: "OUT",
              accountId: 1,
            }),
          ]),
      }),
    });

    renderList();

    // Only the IN leg is visible as a merged row, labeled "Transfer" since
    // its partner (the OUT leg) isn't in the filtered `transactions` array.
    fireEvent.click(screen.getByText("Transfer"));

    const editButton = await screen.findByRole("button", { name: "Edit transaction" });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(mockDbTransactionsWhere).toHaveBeenCalledWith("transferGroupId");
    });
  });
});

describe("TransactionList — bulk delete failure toast", () => {
  it("shows a QuotaError-specific message when a revert fails with QuotaError", async () => {
    mockTransactions = [makeTx({ id: 1 })];
    mockRevertTransaction.mockRejectedValue(new MockQuotaError("Storage quota exceeded"));

    renderList();

    act(() => {
      useUIStore.getState().toggleTransactionSelection(1);
    });

    const removeButton = await screen.findByRole("button", {
      name: "Remove selected transactions",
    });
    fireEvent.click(removeButton);

    const confirmButton = await screen.findByRole("button", { name: "Remove" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("storage is full"),
        "error",
      );
    });
  });

  it("shows the underlying error message for a non-quota failure", async () => {
    mockTransactions = [makeTx({ id: 1 })];
    mockRevertTransaction.mockRejectedValue(new Error("archived account"));

    renderList();

    act(() => {
      useUIStore.getState().toggleTransactionSelection(1);
    });

    const removeButton = await screen.findByRole("button", {
      name: "Remove selected transactions",
    });
    fireEvent.click(removeButton);

    const confirmButton = await screen.findByRole("button", { name: "Remove" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("archived account"),
        "error",
      );
    });
  });
});
