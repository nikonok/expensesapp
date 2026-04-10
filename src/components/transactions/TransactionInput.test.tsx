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
      <button onClick={onCalendarPress}>Calendar</button>
    </div>
  ),
}));
vi.mock("@/components/shared/ComingSoonStub", () => ({
  ComingSoonStub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/services/math-parser", () => ({
  evaluateExpression: vi.fn((v: string) => (v ? parseFloat(v) : null)),
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
