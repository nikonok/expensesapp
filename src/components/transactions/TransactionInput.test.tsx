/* @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Account, Category } from "@/db/models";

vi.mock("@/db/database", () => ({
  db: {
    transactions: { get: vi.fn().mockResolvedValue(null) },
    accounts: { filter: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) },
  },
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: vi.fn(() => undefined) }));
vi.mock("@/hooks/use-accounts", () => ({ useAccounts: vi.fn(() => []) }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: vi.fn(() => []) }));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn(() => ({
    mainCurrency: "USD",
    language: "en",
    startupScreen: "transactions",
    notificationEnabled: false,
    notificationTime: "20:00",
    lastUsedAccountId: null,
    autoBackupIntervalHours: null,
    lastAutoBackupAt: null,
    hasCompletedOnboarding: true,
    isLoaded: true,
    load: vi.fn(),
    update: vi.fn(),
  })),
}));
vi.mock("@/stores/ui-store", () => ({
  useUIStore: vi.fn((sel: (s: unknown) => unknown) => sel({ transactionAccountFilter: null })),
}));
vi.mock("@/components/shared/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/services/exchange-rate.service", () => ({
  exchangeRateService: { getRate: vi.fn().mockResolvedValue(1) },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/services/balance.service", () => ({
  applyTransaction: vi.fn().mockResolvedValue(undefined),
  applyTransfer: vi.fn().mockResolvedValue(undefined),
  replaceTransaction: vi.fn().mockResolvedValue(undefined),
  replaceTransfer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/components/shared/IconPicker", () => ({ getLucideIcon: () => null }));
vi.mock("@/components/shared/CalendarPicker", () => ({
  CalendarPicker: () => null,
}));
vi.mock("@/components/shared/Numpad", () => ({
  Numpad: ({
    onChange,
    onSave,
    onCalendarPress,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSave: (v: number) => void;
    onCalendarPress?: () => void;
    variant?: string;
    isTransfer?: boolean;
  }) => (
    <div>
      <button onClick={() => onSave(100)}>Save</button>
      <button onClick={() => onChange("99")}>Type 99</button>
      <button onClick={onCalendarPress}>Calendar</button>
    </div>
  ),
}));
vi.mock("@/components/shared/ComingSoonStub", () => ({
  ComingSoonStub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/services/math-parser", () => ({
  evaluateExpression: vi.fn((v: string) => (v ? Math.round(parseFloat(v) * 100) : null)),
}));
vi.mock("@/utils/date-utils", () => ({
  getLocalDateString: () => "2024-01-15",
}));
vi.mock("@/utils/numpad-utils", () => ({
  formatNumpadDisplay: (v: string) => v || "0",
}));
vi.mock("@/services/debt-payment.service", () => ({
  getMonthlyRate: vi.fn(() => null),
  calculatePaymentSplit: vi.fn(() => ({ interestAmount: 0, principalAmount: 0 })),
  calculateMortgagePayment: vi.fn(() => 233837),
  calculateTermSaved: vi.fn(() => 6),
}));

import TransactionInput from "@/components/transactions/TransactionInput";
import { useAccounts } from "@/hooks/use-accounts";
import { useCategories } from "@/hooks/use-categories";

vi.spyOn(window.history, "pushState").mockImplementation(() => {});
vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Checking",
    type: "REGULAR",
    color: "oklch(72% 0.22 210)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 1000,
    startingBalance: 0,
    includeInTotal: true,
    isTrashed: false,
    savingsGoal: null,
    savingsInterestRate: null,
    interestRateMonthly: null,
    interestRateYearly: null,
    debtOriginalAmount: null,
    mortgageLoanAmount: null,
    mortgageStartDate: null,
    mortgageTermYears: null,
    mortgageInterestRate: null,
    autoAccrueInterest: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 10,
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

beforeEach(() => {
  vi.mocked(useAccounts).mockReturnValue([]);
  vi.mocked(useCategories).mockReturnValue([]);
});

describe("handleStep3FromPick", () => {
  it("account pick in income mode: txType switches to expense, category and toAccount cleared", async () => {
    const fromAccount = makeAccount({ id: 1, name: "Checking", type: "REGULAR" });
    const destAccount = makeAccount({ id: 2, name: "Savings", type: "REGULAR" });
    const incomeCat = makeCategory({ id: 20, name: "Salary", type: "INCOME" });

    vi.mocked(useAccounts).mockReturnValue([fromAccount, destAccount]);
    vi.mocked(useCategories).mockReturnValue([incomeCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 1: expense mode by default, shows accounts and income categories
    // Click the income category → sets txType=income, moves to step 2
    await act(async () => {
      fireEvent.click(screen.getByText("Salary"));
    });

    // Step 2: income mode — shows non-debt accounts as income destination
    await act(async () => {
      fireEvent.click(screen.getByText("Savings"));
    });

    // Step 3: income mode, FROM pill = Salary, TO pill = Savings
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
      expect(screen.getByText("Savings")).toBeTruthy();
    });

    // Open FROM picker (income mode → shows income categories)
    const fromPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Salary") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(fromPill!);
    });

    // FROM picker open with Salary as the income category option
    const salaryOptions = screen.getAllByText("Salary");
    // salaryOptions[0] is in the pill, salaryOptions[1] is in the picker
    await act(async () => {
      fireEvent.click(salaryOptions[salaryOptions.length - 1]);
    });

    // After picking income category: txType stays income, FROM pill shows income cat
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
    });
    // Savings stays as the TO destination (income mode: account in TO)
    expect(screen.getByText("Savings")).toBeTruthy();
  });

  it("account pick in expense mode (no conflict): FROM pill updates to new account", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const accountB = makeAccount({ id: 2, name: "Savings" });
    const expenseCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });

    vi.mocked(useAccounts).mockReturnValue([accountA, accountB]);
    vi.mocked(useCategories).mockReturnValue([expenseCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?accountId=1&categoryId=10"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 3: FROM=Checking, TO=Food category
    await waitFor(() => {
      expect(screen.getByText("Checking")).toBeTruthy();
      expect(screen.getByText("Food")).toBeTruthy();
    });

    // Open FROM picker (expense mode → shows non-debt accounts)
    const fromPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Checking") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(fromPill!);
    });

    // FROM picker shows Savings — click it
    const savingsItems = screen.getAllByText("Savings");
    await act(async () => {
      fireEvent.click(savingsItems[0]);
    });

    // FROM pill now shows Savings, TO pill still shows Food
    await waitFor(() => {
      expect(screen.getByText("Savings")).toBeTruthy();
      expect(screen.getByText("Food")).toBeTruthy();
    });
  });

  it("account pick in expense mode (no conflict with toAccount): FROM updates, toAccount preserved", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const accountB = makeAccount({ id: 2, name: "SecondAccount" });
    const expenseCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });

    vi.mocked(useAccounts).mockReturnValue([accountA, accountB]);
    vi.mocked(useCategories).mockReturnValue([expenseCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 1: click Checking
    await act(async () => {
      fireEvent.click(screen.getByText("Checking"));
    });

    // Step 2: click Food to go to step 3
    await act(async () => {
      fireEvent.click(screen.getByText("Food"));
    });

    // Step 3: FROM=Checking, TO=Food
    await waitFor(() => {
      expect(screen.getByText("Checking")).toBeTruthy();
      expect(screen.getByText("Food")).toBeTruthy();
    });

    // Open FROM picker (expense mode → shows accounts: Checking, SecondAccount)
    const fromPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Checking") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(fromPill!);
    });

    // Wait for FROM picker to open and SecondAccount to appear
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("SecondAccount")),
      ).toBeTruthy();
    });

    // Pick SecondAccount — pick.account.id (2) !== toAccount?.id (null) → no conflict
    // txType stays expense, TO still shows Food
    const secondBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("SecondAccount"))!;
    await act(async () => {
      fireEvent.click(secondBtn);
    });

    // FROM pill now shows SecondAccount, TO pill still shows Food
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button")
          .find(
            (b) => b.textContent?.includes("SecondAccount") && !b.textContent?.includes("Save"),
          ),
      ).toBeTruthy();
      expect(screen.getByText("Food")).toBeTruthy();
    });
  });

  it("account pick in transfer mode (no conflict): transfer mode preserved with toAccount intact", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const accountB = makeAccount({ id: 2, name: "TransferDest" });
    const accountC = makeAccount({ id: 3, name: "ThirdAccount" });
    const expenseCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });

    vi.mocked(useAccounts).mockReturnValue([accountA, accountB, accountC]);
    vi.mocked(useCategories).mockReturnValue([expenseCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 1: click Checking
    await act(async () => {
      fireEvent.click(screen.getByText("Checking"));
    });

    // Step 2: click Food to go to step 3
    await act(async () => {
      fireEvent.click(screen.getByText("Food"));
    });

    await waitFor(() => {
      expect(screen.getByText("Food")).toBeTruthy();
    });

    // Open TO picker and pick TransferDest as transfer account
    const toPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Food") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(toPill!);
    });

    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("TransferDest")),
      ).toBeTruthy();
    });

    const transferDestBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("TransferDest"))!;
    await act(async () => {
      fireEvent.click(transferDestBtn);
    });

    // Now txType=transfer, toAccount=TransferDest, TO pill shows TransferDest
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("TransferDest") && !b.textContent?.includes("Save")),
      ).toBeTruthy();
    });

    // Open FROM picker (transfer mode — shows non-DEBT accounts excluding toAccount=TransferDest)
    // Shows: Checking, ThirdAccount (NOT TransferDest)
    const fromPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Checking") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(fromPill!);
    });

    // Pick ThirdAccount from FROM picker
    // pick.account.id (3) !== toAccount.id (2) → no conflict → stays transfer, toAccount preserved
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("ThirdAccount")),
      ).toBeTruthy();
    });

    const thirdBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("ThirdAccount"))!;
    await act(async () => {
      fireEvent.click(thirdBtn);
    });

    // FROM pill shows ThirdAccount, TO pill still shows TransferDest (transfer mode preserved)
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("ThirdAccount") && !b.textContent?.includes("Save")),
      ).toBeTruthy();
      expect(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("TransferDest") && !b.textContent?.includes("Save")),
      ).toBeTruthy();
    });
  });

  it("income category pick with REGULAR account: FROM pill shows income category, txType becomes income, account preserved", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking", type: "REGULAR" });
    const incomeCat = makeCategory({ id: 20, name: "Salary", type: "INCOME" });

    vi.mocked(useAccounts).mockReturnValue([accountA]);
    vi.mocked(useCategories).mockReturnValue([incomeCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?categoryId=20&accountId=1"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 3 income mode: FROM pill = Salary, TO pill = Checking
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
      expect(screen.getByText("Checking")).toBeTruthy();
    });

    // Open FROM picker (income mode → shows income categories)
    const fromPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Salary") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(fromPill!);
    });

    // FROM picker shows Salary — pick it
    // handleStep3FromPick({ type: 'incomeCategory', category: incomeCat })
    // account.type !== 'DEBT' → account stays, txType→income, toAccount→null
    const salaryOptions = screen.getAllByText("Salary");
    await act(async () => {
      fireEvent.click(salaryOptions[salaryOptions.length - 1]);
    });

    // FROM pill still shows Salary (income cat), TO pill still shows Checking (account preserved)
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
      expect(screen.getByText("Checking")).toBeTruthy();
    });
  });

  it("income category pick with DEBT account: FROM pill shows income category, account is cleared", async () => {
    const debtAccount = makeAccount({ id: 5, name: "CreditCard", type: "DEBT" });
    const regularAccount = makeAccount({ id: 1, name: "Checking", type: "REGULAR" });
    const incomeCat = makeCategory({ id: 20, name: "Salary", type: "INCOME" });

    // Provide a regular account so we can navigate via step 2 to step 3
    // Then set up a scenario where a DEBT account is the FROM account
    vi.mocked(useAccounts).mockReturnValue([regularAccount, debtAccount]);
    vi.mocked(useCategories).mockReturnValue([incomeCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?categoryId=20"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 3 income mode with categoryId=20 (Salary)
    // No accountId → account starts null (useLiveQuery returns undefined → defaultAccount null)
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
    });

    // TO pill shows placeholder (no account set)
    expect(screen.getByText("transactions.fields.to")).toBeTruthy();

    // Open FROM picker (income mode → shows income categories)
    const fromPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Salary") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(fromPill!);
    });

    // FROM picker shows Salary — pick it
    // handleStep3FromPick({ type: 'incomeCategory', category: incomeCat })
    // account is null → DEBT check skipped → txType→income, toAccount→null
    const salaryOptions = screen.getAllByText("Salary");
    await act(async () => {
      fireEvent.click(salaryOptions[salaryOptions.length - 1]);
    });

    // FROM pill still shows Salary, TO still shows placeholder
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
      expect(screen.getByText("transactions.fields.to")).toBeTruthy();
    });
  });
});

describe("handleStep3ToPick", () => {
  it("expenseCategory: TO pill shows the selected category name", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const foodCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });
    const transportCat = makeCategory({ id: 11, name: "Transport", type: "EXPENSE" });

    vi.mocked(useAccounts).mockReturnValue([accountA]);
    vi.mocked(useCategories).mockReturnValue([foodCat, transportCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?accountId=1&categoryId=10"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 3: FROM=Checking, TO=Food
    await waitFor(() => {
      expect(screen.getByText("Checking")).toBeTruthy();
      expect(screen.getByText("Food")).toBeTruthy();
    });

    // Open TO picker and pick Transport
    const toPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Food") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(toPill!);
    });

    const transportItems = screen.getAllByText("Transport");
    await act(async () => {
      fireEvent.click(transportItems[0]);
    });

    // TO pill now shows Transport
    await waitFor(() => {
      expect(screen.getByText("Transport")).toBeTruthy();
    });
  });

  it("debtAccount: TO pill shows debt account name", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const debtAcc = makeAccount({ id: 3, name: "LoanAccount", type: "DEBT" });
    const foodCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });

    vi.mocked(useAccounts).mockReturnValue([accountA, debtAcc]);
    vi.mocked(useCategories).mockReturnValue([foodCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 1: click Checking to go to step 2
    await act(async () => {
      fireEvent.click(screen.getByText("Checking"));
    });

    // Step 2: click Food category to go to step 3
    await act(async () => {
      fireEvent.click(screen.getByText("Food"));
    });

    // Step 3: FROM=Checking, TO=Food category
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeTruthy();
    });

    // Open TO picker
    const toPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Food") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(toPill!);
    });

    // Picker open: click LoanAccount (debt account)
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("LoanAccount")),
      ).toBeTruthy();
    });

    const loanBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("LoanAccount"))!;
    await act(async () => {
      fireEvent.click(loanBtn);
    });

    // TO pill shows LoanAccount (debt payment mode, showToTarget=true)
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("LoanAccount")),
      ).toBeTruthy();
    });
  });

  it("transferAccount: TO pill shows the transfer destination account name", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const accountB = makeAccount({ id: 2, name: "SavingsAccount" });
    const foodCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });

    vi.mocked(useAccounts).mockReturnValue([accountA, accountB]);
    vi.mocked(useCategories).mockReturnValue([foodCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 1: click Checking to go to step 2
    await act(async () => {
      fireEvent.click(screen.getByText("Checking"));
    });

    // Step 2: click Food category to go to step 3
    await act(async () => {
      fireEvent.click(screen.getByText("Food"));
    });

    // Step 3: FROM=Checking, TO=Food category
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeTruthy();
    });

    // Open TO picker
    const toPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Food") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(toPill!);
    });

    // Picker open: click SavingsAccount (transfer destination)
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("SavingsAccount")),
      ).toBeTruthy();
    });

    const savingsBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("SavingsAccount"))!;
    await act(async () => {
      fireEvent.click(savingsBtn);
    });

    // TO pill shows SavingsAccount (transfer mode, showToTarget=true)
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").find((b) => b.textContent?.includes("SavingsAccount")),
      ).toBeTruthy();
    });
  });

  it("incomeDestAccount: TO pill shows the destination account name and FROM still shows income category", async () => {
    const accountA = makeAccount({ id: 1, name: "Checking" });
    const accountB = makeAccount({ id: 2, name: "Savings" });
    const incomeCat = makeCategory({ id: 20, name: "Salary", type: "INCOME" });

    vi.mocked(useAccounts).mockReturnValue([accountA, accountB]);
    vi.mocked(useCategories).mockReturnValue([incomeCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?categoryId=20&accountId=1"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    // Step 3 income mode: FROM=Salary, TO=Checking
    await waitFor(() => {
      expect(screen.getByText("Salary")).toBeTruthy();
      expect(screen.getByText("Checking")).toBeTruthy();
    });

    // Open TO picker (income mode → shows non-debt accounts as income destinations)
    const toPill = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Checking") && !b.textContent?.includes("Save"));
    await act(async () => {
      fireEvent.click(toPill!);
    });

    // Pick Savings as income destination
    // handleStep3ToPick({ type: 'incomeDestAccount', account: accountB })
    // → setAccount(accountB), setToAccount(null), setTxType('income')
    const savingsItems = screen.getAllByText("Savings");
    await act(async () => {
      fireEvent.click(savingsItems[0]);
    });

    // TO pill (income mode) now shows Savings, FROM pill still shows Salary
    await waitFor(() => {
      expect(screen.getByText("Savings")).toBeTruthy();
      expect(screen.getByText("Salary")).toBeTruthy();
    });
  });
});

// ── Helper shared by cross-currency debt tests ─────────────────────────────

async function navigateToDebtPayment(sourceAccount: Account, debtAccount: Account) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/transactions/new"]}>
        <TransactionInput />
      </MemoryRouter>,
    );
  });
  // Step 1: pick source account
  await act(async () => {
    fireEvent.click(screen.getByText(sourceAccount.name));
  });
  // Step 2: pick debt account → isDebtPaymentMode = true
  await act(async () => {
    fireEvent.click(screen.getByText(debtAccount.name));
  });
  // Wait for Step 3
  await waitFor(() => {
    expect(screen.getByText("Save")).toBeTruthy();
  });
}

// ── Bug #2: cross-currency debt payment fields ─────────────────────────────

describe("cross-currency debt payment (Bug #2)", () => {
  beforeEach(() => {
    vi.mocked(useCategories).mockReturnValue([]);
  });

  it("showDebtDestForeign: renders destination currency input when source ≠ debt currency", async () => {
    // mainCurrency=USD (mock), source=EUR, debt=GBP → toAccount2ndCurrencyDiffers=true
    const eurAccount = makeAccount({ id: 1, name: "EUR Wallet", currency: "EUR" });
    const gbpDebt = makeAccount({ id: 2, name: "GBP Loan", type: "DEBT", currency: "GBP" });
    vi.mocked(useAccounts).mockReturnValue([eurAccount, gbpDebt]);

    await navigateToDebtPayment(eurAccount, gbpDebt);

    // The destination block is shown (now a tappable div, not a native input)
    expect(screen.getByText("GBP")).toBeTruthy();
    // no native spinbutton input (it's now a tappable div)
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("showDebtMainCurrency: renders ≈ main-currency field when all 3 currencies differ", async () => {
    // mainCurrency=USD, source=EUR, debt=GBP → EUR≠USD, GBP≠USD, EUR≠GBP
    const eurAccount = makeAccount({ id: 1, name: "EUR Wallet", currency: "EUR" });
    const gbpDebt = makeAccount({ id: 2, name: "GBP Loan", type: "DEBT", currency: "GBP" });
    vi.mocked(useAccounts).mockReturnValue([eurAccount, gbpDebt]);

    await navigateToDebtPayment(eurAccount, gbpDebt);

    expect(screen.getByText("≈")).toBeTruthy();
    // Main currency (USD) label visible in the 3-currency field
    const usdLabels = screen.getAllByText("USD");
    expect(usdLabels.length).toBeGreaterThan(0);
  });

  it("no cross-currency fields when source and debt share the same currency", async () => {
    // source=USD=debt → toAccount2ndCurrencyDiffers=false → both flags false
    const usdAccount = makeAccount({ id: 1, name: "USD Wallet", currency: "USD" });
    const usdDebt = makeAccount({ id: 2, name: "USD Loan", type: "DEBT", currency: "USD" });
    vi.mocked(useAccounts).mockReturnValue([usdAccount, usdDebt]);

    await navigateToDebtPayment(usdAccount, usdDebt);

    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.queryByText("≈")).toBeNull();
  });

  it("showDebtMainCurrency hidden when source equals main currency (only 2 currencies differ)", async () => {
    // source=USD=mainCurrency, debt=GBP → showDebtDestForeign=true, showDebtMainCurrency=false
    const usdAccount = makeAccount({ id: 1, name: "USD Wallet", currency: "USD" });
    const gbpDebt = makeAccount({ id: 2, name: "GBP Loan", type: "DEBT", currency: "GBP" });
    vi.mocked(useAccounts).mockReturnValue([usdAccount, gbpDebt]);

    await navigateToDebtPayment(usdAccount, gbpDebt);

    // Destination block shown (showDebtDestForeign=true: USD≠GBP)
    expect(screen.getByText("GBP")).toBeTruthy();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    // No ≈ field (showDebtMainCurrency=false: fromCurrency=USD=mainCurrency)
    expect(screen.queryByText("≈")).toBeNull();
  });

  it("save uses manually entered destination amount (toSecondaryAmount override)", async () => {
    const { applyTransfer } = await import("@/services/balance.service");
    vi.mocked(applyTransfer).mockClear();

    const eurAccount = makeAccount({ id: 1, name: "EUR Wallet", currency: "EUR" });
    const gbpDebt = makeAccount({ id: 2, name: "GBP Loan", type: "DEBT", currency: "GBP" });
    vi.mocked(useAccounts).mockReturnValue([eurAccount, gbpDebt]);

    await navigateToDebtPayment(eurAccount, gbpDebt);

    // Tap the destination amount div to focus it (shows "0" when empty)
    const destDiv = screen.getAllByText("0")[0];
    await act(async () => {
      fireEvent.click(destDiv);
    });

    // Type 99 via the mocked Numpad (onChange → onToSecondaryAmountChange)
    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // Save: Numpad mock calls onSave(100) → primary amount = 100 EUR
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    await waitFor(() => {
      expect(applyTransfer).toHaveBeenCalled();
      const calls = vi.mocked(applyTransfer).mock.calls;
      const [, inTx] = calls[calls.length - 1];
      // IN leg (debt account) must use the user-entered 99 → Math.round(99 * 100) = 9900
      expect(inTx.amount).toBe(9900);
    });
  });

  it("save auto-calculates inTx.amount from exchange rate when destination not overridden", async () => {
    const { applyTransfer } = await import("@/services/balance.service");
    const { exchangeRateService } = await import("@/services/exchange-rate.service");
    vi.mocked(applyTransfer).mockClear();
    vi.mocked(exchangeRateService.getRate).mockImplementation((from, to) => {
      if (from === "EUR" && to === "GBP") return Promise.resolve(0.85);
      return Promise.resolve(1);
    });

    const eurAccount = makeAccount({ id: 1, name: "EUR Wallet", currency: "EUR" });
    const gbpDebt = makeAccount({ id: 2, name: "GBP Loan", type: "DEBT", currency: "GBP" });
    vi.mocked(useAccounts).mockReturnValue([eurAccount, gbpDebt]);

    await navigateToDebtPayment(eurAccount, gbpDebt);

    // Do NOT touch the destination input — let auto-calc from exchange rate run
    // Save: primary amount = 100 EUR (Numpad mock)
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    await waitFor(() => {
      expect(applyTransfer).toHaveBeenCalled();
      const calls = vi.mocked(applyTransfer).mock.calls;
      const [, inTx] = calls[calls.length - 1];
      // 100 EUR × 0.85 = 85 GBP
      expect(inTx.amount).toBe(85);
    });
  });
});

// ── Bug #1: secondaryManual only resets on primary numpad edit ─────────────

describe("secondaryManual reset fix (Bug #1)", () => {
  it("manual secondary override is preserved after clicking the primary amount area", async () => {
    // Bug #1 was: a useEffect reset secondaryManual=false whenever focusedField changed
    // to 'primary' — even if the user just tapped elsewhere without editing the source amount.
    // Fix: secondaryManual only resets inside handleNumpadChange (on actual primary keystroke).
    //
    // Observable: if user types 99 in the secondary (≈ USD) field, then clicks the primary
    // amount display (which switches focusedField to 'primary' but does NOT edit the amount),
    // then saves — amountMainCurrency should be 99, not 100 × exchange_rate.
    const { applyTransaction } = await import("@/services/balance.service");
    const { exchangeRateService } = await import("@/services/exchange-rate.service");
    vi.mocked(applyTransaction).mockClear();
    // EUR → USD = 1.1 (so auto-calc would give 100 × 1.1 = 110 if override is lost)
    vi.mocked(exchangeRateService.getRate).mockResolvedValue(1.1);

    const expenseCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });
    const eurAccount = makeAccount({ id: 1, name: "EUR Wallet", currency: "EUR" });
    vi.mocked(useAccounts).mockReturnValue([eurAccount]);
    vi.mocked(useCategories).mockReturnValue([expenseCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?accountId=1&categoryId=10"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    await waitFor(() => expect(screen.getByText("Save")).toBeTruthy());

    // 1. Click ≈ to switch focusedField → 'secondary'
    await act(async () => {
      fireEvent.click(screen.getByText("≈"));
    });

    // 2. Numpad onChange now routes to handleSecondaryAmountChange
    //    'Type 99' button calls onChange('99') → secondaryAmount='99', secondaryManual=true
    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // 3. Click the primary amount display ('0') → onFocusedFieldChange('primary')
    //    Old bug: this would reset secondaryManual=false, triggering auto-calc
    //    Fix: this does NOT reset secondaryManual
    await act(async () => {
      fireEvent.click(screen.getByText("0"));
    });

    // Allow any async exchange-rate effects to settle
    await act(async () => {});

    // 4. Save (Numpad onSave(100) → primary amount = 100 EUR)
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    await waitFor(() => {
      expect(applyTransaction).toHaveBeenCalled();
      const calls = vi.mocked(applyTransaction).mock.calls;
      const tx = calls[calls.length - 1][0];
      // secondaryManual stayed true → amountMainCurrency = Math.round(99 * 100) = 9900 (manual override)
      // If Bug #1 still present: secondaryManual reset → amountMainCurrency = 110 (exchange rate)
      expect(tx.amountMainCurrency).toBe(9900);
    });
  });

  it("manual secondary override IS reset when the primary amount is edited via numpad", async () => {
    // Verifies the forward behavior: handleNumpadChange (primary keystroke) DOES reset
    // secondaryManual, so the exchange rate auto-calc takes over.
    const { applyTransaction } = await import("@/services/balance.service");
    const { exchangeRateService } = await import("@/services/exchange-rate.service");
    vi.mocked(applyTransaction).mockClear();
    vi.mocked(exchangeRateService.getRate).mockResolvedValue(1.1); // EUR→USD

    const expenseCat = makeCategory({ id: 10, name: "Food", type: "EXPENSE" });
    const eurAccount = makeAccount({ id: 1, name: "EUR Wallet", currency: "EUR" });
    vi.mocked(useAccounts).mockReturnValue([eurAccount]);
    vi.mocked(useCategories).mockReturnValue([expenseCat]);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/transactions/new?accountId=1&categoryId=10"]}>
          <TransactionInput />
        </MemoryRouter>,
      );
    });

    await waitFor(() => expect(screen.getByText("Save")).toBeTruthy());

    // 1. Set secondaryManual=true by typing in the secondary field
    await act(async () => {
      fireEvent.click(screen.getByText("≈"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // 2. Edit the primary field (Numpad onChange while focusedField='primary')
    //    First switch back to primary
    await act(async () => {
      fireEvent.click(screen.getByText("0"));
    });
    // Now 'Type 99' button calls handleNumpadChange('99') → resets secondaryManual=false
    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // Allow auto-calc effect to run (secondaryManual=false, numpadValue changed)
    await act(async () => {});

    // 3. Save — auto-calc should have updated secondaryAmount to '99' × 1.1 from exchange rate
    // Actually: numpadValue='99' → evaluateExpression('99')=99 → secondaryAmount = 99×1.1=108.9
    // amountMainCurrency should NOT be 99 (that was the old manual value)
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    await waitFor(() => {
      expect(applyTransaction).toHaveBeenCalled();
      const calls = vi.mocked(applyTransaction).mock.calls;
      const tx = calls[calls.length - 1][0];
      // secondaryManual reset → uses exchange rate: 100 × 1.1 = 110
      // (Save mock always calls onSave(100), so amount=100)
      expect(tx.amountMainCurrency).toBe(110);
    });
  });
});

// ── Mortgage overpayment features ─────────────────────────────────────────────

describe("mortgage overpayment features", () => {
  const sourceAccount = makeAccount({ id: 1, name: "Wallet", type: "REGULAR", currency: "USD" });
  const mortgageAccount = makeAccount({
    id: 2,
    name: "Mortgage",
    type: "DEBT",
    currency: "USD",
    balance: -38000000,
    mortgageLoanAmount: 40000000,
    mortgageTermYears: 25,
    mortgageInterestRate: 0.05,
    debtOriginalAmount: 40000000,
  });

  beforeEach(() => {
    vi.mocked(useCategories).mockReturnValue([]);
    vi.mocked(useAccounts).mockReturnValue([sourceAccount, mortgageAccount]);
  });

  it("switching to Overpayment hides the interest/principal split preview", async () => {
    const { getMonthlyRate } = await import("@/services/debt-payment.service");
    vi.mocked(getMonthlyRate).mockReturnValue(0.05 / 12);

    await navigateToDebtPayment(sourceAccount, mortgageAccount);

    // Type an amount so currentAmount > 0 → split preview appears in regular mode
    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // In regular payment mode, the interest/principal split is computed
    // (paymentSplit is non-null when currentAmount > 0 and monthlyRate non-null)
    await waitFor(() => {
      expect(screen.getByText("transactions.debtPayment.interest")).toBeTruthy();
    });

    // Click the overpayment toggle button (i18n mock returns key as-is)
    await act(async () => {
      fireEvent.click(screen.getByText("transactions.debtPayment.overpayment"));
    });

    // In overpayment mode, paymentSplit is null → split preview disappears
    await waitFor(() => {
      expect(screen.queryByText("transactions.debtPayment.interest")).toBeNull();
    });
  });

  it("switching to Overpayment with amount entered shows term savings text", async () => {
    const { getMonthlyRate } = await import("@/services/debt-payment.service");
    vi.mocked(getMonthlyRate).mockReturnValue(0.05 / 12);

    await navigateToDebtPayment(sourceAccount, mortgageAccount);

    // Type an amount so currentAmount > 0
    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // Switch to overpayment mode
    await act(async () => {
      fireEvent.click(screen.getByText("transactions.debtPayment.overpayment"));
    });

    // Term savings text appears (calculateTermSaved mocked to return 6)
    await waitFor(() => {
      expect(screen.getByText("transactions.debtPayment.termSaved")).toBeTruthy();
    });
  });

  it("staying on Regular Payment does not show term savings text", async () => {
    const { getMonthlyRate } = await import("@/services/debt-payment.service");
    vi.mocked(getMonthlyRate).mockReturnValue(0.05 / 12);

    await navigateToDebtPayment(sourceAccount, mortgageAccount);

    await act(async () => {
      fireEvent.click(screen.getByText("Type 99"));
    });

    // Do NOT click overpayment — stay on regular payment
    expect(screen.queryByText("transactions.debtPayment.termSaved")).toBeNull();
  });

  it("outTx has null interestAmount when saving in overpayment mode", async () => {
    const { getMonthlyRate } = await import("@/services/debt-payment.service");
    const { applyTransfer } = await import("@/services/balance.service");
    vi.mocked(getMonthlyRate).mockReturnValue(0.05 / 12);
    vi.mocked(applyTransfer).mockClear();

    await navigateToDebtPayment(sourceAccount, mortgageAccount);

    // Switch to overpayment mode
    await act(async () => {
      fireEvent.click(screen.getByText("transactions.debtPayment.overpayment"));
    });

    // Save (Numpad mock calls onSave(100))
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    await waitFor(() => {
      expect(applyTransfer).toHaveBeenCalled();
      const calls = vi.mocked(applyTransfer).mock.calls;
      const outTx = calls[calls.length - 1][0];
      // In overpayment mode, no interest/principal split is computed
      expect(outTx.interestAmount).toBeNull();
      expect(outTx.principalAmount).toBeNull();
    });
  });
});
