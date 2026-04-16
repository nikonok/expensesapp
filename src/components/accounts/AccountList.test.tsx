/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Account } from "../../db/models";

// Stub heavy child components to avoid deep dependency trees
vi.mock("./AccountCard", () => ({ default: () => null }));
vi.mock("./AccountForm", () => ({ default: () => null }));
vi.mock("./AccountDetail", () => ({ default: () => null }));
vi.mock("./TotalWealth", () => ({ default: () => null }));
vi.mock("../shared/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../layout/BottomSheet", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("react-router", () => ({ useNavigate: vi.fn(() => vi.fn()) }));
vi.mock("../../hooks/use-accounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../../hooks/use-total-balance", () => ({ useTotalBalance: vi.fn() }));

import AccountList from "./AccountList";
import { useAccounts } from "../../hooks/use-accounts";
import { useTotalBalance } from "../../hooks/use-total-balance";

const dummyAccount: Account = {
  id: 1,
  name: "Checking",
  type: "REGULAR",
  color: "oklch(72% 0.22 210)",
  icon: "wallet",
  currency: "USD",
  description: "",
  balance: 1_000_000,
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
};

describe("AccountList — Total Balance display", () => {
  beforeEach(() => {
    vi.mocked(useAccounts).mockReturnValue([dummyAccount]);
  });

  it("displays minor-unit netWorth divided by 100 (10000 minor units = $100.00)", () => {
    vi.mocked(useTotalBalance).mockReturnValue({ netWorth: 1_000_000, mainCurrency: "USD" });

    render(<AccountList />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("$10,000.00");
  });

  it("does not show the raw minor-unit value (regression guard)", () => {
    vi.mocked(useTotalBalance).mockReturnValue({ netWorth: 1_000_000, mainCurrency: "USD" });

    render(<AccountList />);

    expect(screen.queryByText("$1,000,000.00")).toBeNull();
  });

  it("displays a negative netWorth correctly divided by 100", () => {
    vi.mocked(useTotalBalance).mockReturnValue({ netWorth: -50_000, mainCurrency: "EUR" });

    render(<AccountList />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("500"); // €500.00 in some locale
    expect(Number(status.textContent!.replace(/[^0-9.]/g, ""))).toBeCloseTo(500, 0);
  });

  it("shows the loading ellipsis when netWorth is null", () => {
    vi.mocked(useTotalBalance).mockReturnValue({ netWorth: null, mainCurrency: "USD" });

    render(<AccountList />);

    expect(screen.getByRole("status").textContent).toBe("…");
  });
});
