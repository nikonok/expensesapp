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
    renderDetail(makeAccount({ balance: 150000 }));
    act(() => {
      fireEvent.click(screen.getByText("Adjust Balance"));
    });
    expect(screen.getByTestId("numpad-value").textContent).toBe("1500");
  });

  it("uses the absolute value for a negative balance (debt account)", () => {
    renderDetail(makeAccount({ type: "DEBT", balance: -300000 }));
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

describe("mortgage time remaining", () => {
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

  it("shows Xy Zm pattern for a standard mortgage with remaining balance", () => {
    renderDetail(
      makeAccount({
        type: "DEBT",
        mortgageLoanAmount: 200000,
        mortgageTermYears: 25,
        mortgageInterestRate: 0.05,
        balance: -150000,
      }),
    );
    expect(screen.getByText(/^\d+y \d+m$/)).toBeTruthy();
  });

  it("shows 'Paid off' when balance is zero", () => {
    renderDetail(
      makeAccount({
        type: "DEBT",
        mortgageLoanAmount: 200000,
        mortgageTermYears: 25,
        mortgageInterestRate: 0.05,
        balance: 0,
      }),
    );
    expect(screen.getByText("Paid off")).toBeTruthy();
  });

  it("shows '5y 0m' for a zero-interest mortgage with exactly half the balance remaining", () => {
    renderDetail(
      makeAccount({
        type: "DEBT",
        mortgageLoanAmount: 120000,
        mortgageTermYears: 10,
        mortgageInterestRate: 0,
        balance: -60000,
      }),
    );
    expect(screen.getByText("5y 0m")).toBeTruthy();
  });

  it("shows nothing when balance exceeds serviceable threshold (x <= 0)", () => {
    // A 25y 5% mortgage with a balance far above the original loan amount
    // triggers x <= 0 and should show neither "Paid off" nor a time string
    const { container } = renderDetail(
      makeAccount({
        type: "DEBT",
        mortgageLoanAmount: 200000,
        mortgageTermYears: 25,
        mortgageInterestRate: 0.05,
        balance: -999999999, // absurdly large — interest alone exceeds monthly payment
      }),
    );
    expect(screen.queryByText("Paid off")).toBeNull();
    expect(screen.queryByText(/\d+y \d+m/)).toBeNull();
    // timeLeft stays null so the "Time remaining" label is also absent
    expect(container.querySelector('[data-testid="time-remaining"]')).toBeNull();
    expect(screen.queryByText("Time remaining")).toBeNull();
  });

  it("shows a shorter time remaining for a lower balance (overpayment effect)", () => {
    const mortgageParams = {
      type: "DEBT" as const,
      mortgageLoanAmount: 200000,
      mortgageTermYears: 25,
      mortgageInterestRate: 0.05,
    };

    const { unmount } = renderDetail(makeAccount({ ...mortgageParams, balance: -100000 }));
    const textA = screen.getByText(/^\d+y \d+m$/).textContent!;
    const [yearsA, monthsA] = textA.match(/\d+/g)!.map(Number);
    const totalMonthsA = yearsA * 12 + monthsA;
    unmount();

    renderDetail(makeAccount({ ...mortgageParams, balance: -50000 }));
    const textB = screen.getByText(/^\d+y \d+m$/).textContent!;
    const [yearsB, monthsB] = textB.match(/\d+/g)!.map(Number);
    const totalMonthsB = yearsB * 12 + monthsB;

    expect(totalMonthsB).toBeLessThan(totalMonthsA);
  });
});
