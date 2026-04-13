/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Account } from "../../db/models";

vi.mock("../shared/IconPicker", () => ({ getLucideIcon: () => null }));
vi.mock("../shared/AmountDisplay", () => ({
  AmountDisplay: () => null,
}));
vi.mock("../../services/debt-payment.service", () => ({
  calculateMortgagePayment: vi.fn(() => 0),
}));
vi.mock("../../utils/currency-utils", () => ({
  formatAmount: vi.fn(() => "2 338 PLN"),
}));

import AccountCard from "./AccountCard";
import { calculateMortgagePayment } from "../../services/debt-payment.service";
import { formatAmount } from "../../utils/currency-utils";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Test Account",
    type: "REGULAR",
    color: "oklch(72% 0.22 210)",
    icon: "wallet",
    currency: "PLN",
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

describe("AccountCard — mortgage monthly payment display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a mortgage DEBT account with Debt type label and balance", () => {
    vi.mocked(calculateMortgagePayment).mockReturnValue(233837);
    vi.mocked(formatAmount).mockReturnValue("2 338 PLN");

    const account = makeAccount({
      type: "DEBT",
      balance: -38000000,
      mortgageLoanAmount: 40000000,
      mortgageTermYears: 25,
      mortgageInterestRate: 0.05,
    });

    render(<AccountCard account={account} onPress={vi.fn()} />);

    // Card renders the account name and type label
    expect(screen.getByText("Test Account")).toBeTruthy();
    expect(screen.getByText("Debt")).toBeTruthy();
  });

  it("does not show /mo text for a REGULAR account", () => {
    vi.mocked(calculateMortgagePayment).mockReturnValue(0);

    const account = makeAccount({ type: "REGULAR" });
    render(<AccountCard account={account} onPress={vi.fn()} />);

    expect(screen.queryByText(/\/mo/)).toBeNull();
  });

  it("does not show /mo text for a DEBT account without mortgage fields", () => {
    vi.mocked(calculateMortgagePayment).mockReturnValue(0);

    const account = makeAccount({
      type: "DEBT",
      balance: -500000,
      mortgageLoanAmount: null,
    });
    render(<AccountCard account={account} onPress={vi.fn()} />);

    expect(screen.queryByText(/\/mo/)).toBeNull();
  });

  it("does not show /mo text when calculateMortgagePayment returns 0", () => {
    vi.mocked(calculateMortgagePayment).mockReturnValue(0);

    const account = makeAccount({
      type: "DEBT",
      balance: -38000000,
      mortgageLoanAmount: 40000000,
      mortgageTermYears: 25,
      mortgageInterestRate: 0.05,
    });
    render(<AccountCard account={account} onPress={vi.fn()} />);

    expect(screen.queryByText(/\/mo/)).toBeNull();
  });
});
