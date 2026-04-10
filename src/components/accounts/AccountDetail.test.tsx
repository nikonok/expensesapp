/* @vitest-environment jsdom */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import AccountDetail from "./AccountDetail";
import type { Account } from "../../db/models";

// ── Dependency mocks ────────────────────────────────────────────────────────
vi.mock("../../db/database", () => ({ db: {} }));
vi.mock("../../services/balance.service", () => ({
  adjustBalance: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../stores/ui-store", () => ({
  useUIStore: (sel: (s: { setTransactionAccountFilter: () => void }) => unknown) =>
    sel({ setTransactionAccountFilter: vi.fn() }),
}));
vi.mock("../shared/Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));
vi.mock("../shared/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("../shared/IconPicker", () => ({ getLucideIcon: () => null }));
// Numpad mock: renders the value prop so we can assert what it was seeded with
vi.mock("../shared/Numpad", () => ({
  Numpad: ({ value }: { value: string; onChange: (v: string) => void; onSave: (v: number) => void; variant: string }) => (
    <span data-testid="numpad-value">{value}</span>
  ),
}));

// ── History mocks for BottomSheet ───────────────────────────────────────────
vi.spyOn(window.history, "pushState").mockImplementation(() => {});
vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Test Account",
    type: "REGULAR",
    color: "oklch(72% 0.22 210)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 0,
    startingBalance: 0,
    includeInTotal: true,
    isTrashed: false,
    savingsGoal: null,
    savingsInterestRate: null,
    interestRateMonthly: null,
    interestRateYearly: null,
    mortgageLoanAmount: null,
    mortgageStartDate: null,
    mortgageTermYears: null,
    mortgageInterestRate: null,
    debtOriginalAmount: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("AccountDetail — adjust balance numpad seeding", () => {
  let onClose: () => void;

  beforeEach(() => {
    onClose = vi.fn();
  });

  function renderDetail(account: Account) {
    return render(
      <MemoryRouter>
        <AccountDetail
          account={account}
          isOpen
          onClose={onClose}
          onEdit={vi.fn()}
        />
      </MemoryRouter>,
    );
  }

  it("seeds numpad with current account balance when Adjust Balance is clicked", () => {
    renderDetail(makeAccount({ balance: 1500 }));
    act(() => {
      fireEvent.click(screen.getByText("Adjust Balance"));
    });
    expect(screen.getByTestId("numpad-value").textContent).toBe("1500");
  });

  it("uses the absolute value for a negative balance (debt account)", () => {
    renderDetail(makeAccount({ type: "DEBT", balance: -3000 }));
    act(() => {
      fireEvent.click(screen.getByText("Adjust Balance"));
    });
    expect(screen.getByTestId("numpad-value").textContent).toBe("3000");
  });

  it("seeds with '0' string when balance is zero", () => {
    renderDetail(makeAccount({ balance: 0 }));
    act(() => {
      fireEvent.click(screen.getByText("Adjust Balance"));
    });
    expect(screen.getByTestId("numpad-value").textContent).toBe("0");
  });
});
