import { describe, it, expect } from "vitest";
import {
  accountSchema,
  categorySchema,
  transactionSchema,
  budgetSchema,
  settingSchemas,
} from "../validation";
import { backupAccountSchema } from "../backup-validation";

// ── accountSchema ──

describe("accountSchema — valid", () => {
  it("accepts a minimal valid REGULAR account", () => {
    const result = accountSchema.safeParse({
      name: "Checking",
      type: "REGULAR",
      color: "oklch(70% 0.15 200)",
      icon: "wallet",
      currency: "USD",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a DEBT account with optional debt fields", () => {
    const result = accountSchema.safeParse({
      name: "My Loan",
      type: "DEBT",
      color: "oklch(60% 0.20 30)",
      icon: "credit-card",
      currency: "EUR",
      description: "Car loan",
      startingBalance: -500000,
      includeInTotal: true,
      debtOriginalAmount: 500000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a SAVINGS account with savingsGoal", () => {
    const result = accountSchema.safeParse({
      name: "Emergency Fund",
      type: "SAVINGS",
      color: "oklch(80% 0.10 150)",
      icon: "piggy-bank",
      currency: "PLN",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
      savingsGoal: 1000000,
    });
    expect(result.success).toBe(true);
  });
});

describe("accountSchema — invalid", () => {
  it("fails when name is empty", () => {
    const result = accountSchema.safeParse({
      name: "",
      type: "REGULAR",
      color: "oklch(70% 0.15 200)",
      icon: "wallet",
      currency: "USD",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
    });
    expect(result.success).toBe(false);
  });

  it("fails when name exceeds 64 characters", () => {
    const result = accountSchema.safeParse({
      name: "A".repeat(65),
      type: "REGULAR",
      color: "oklch(70% 0.15 200)",
      icon: "wallet",
      currency: "USD",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
    });
    expect(result.success).toBe(false);
  });

  it("fails for invalid account type", () => {
    const result = accountSchema.safeParse({
      name: "Cash",
      type: "CASH",
      color: "oklch(70% 0.15 200)",
      icon: "wallet",
      currency: "USD",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
    });
    expect(result.success).toBe(false);
  });

  it("fails for invalid color format (bare hex)", () => {
    const result = accountSchema.safeParse({
      name: "Cash",
      type: "REGULAR",
      color: "#ff0000",
      icon: "wallet",
      currency: "USD",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
    });
    expect(result.success).toBe(false);
  });

  it("fails for currency code that is not 3 characters", () => {
    const result = accountSchema.safeParse({
      name: "Cash",
      type: "REGULAR",
      color: "oklch(70% 0.15 200)",
      icon: "wallet",
      currency: "US",
      description: "",
      startingBalance: 0,
      includeInTotal: true,
    });
    expect(result.success).toBe(false);
  });

  it("fails when startingBalance is missing", () => {
    const result = accountSchema.safeParse({
      name: "Cash",
      type: "REGULAR",
      color: "oklch(70% 0.15 200)",
      icon: "wallet",
      currency: "USD",
      description: "",
      includeInTotal: true,
    });
    expect(result.success).toBe(false);
  });
});

// ── categorySchema ──

describe("categorySchema — valid", () => {
  it("accepts a valid EXPENSE category", () => {
    const result = categorySchema.safeParse({
      name: "Groceries",
      type: "EXPENSE",
      color: "oklch(70% 0.15 200)",
      icon: "shopping-cart",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid INCOME category", () => {
    const result = categorySchema.safeParse({
      name: "Salary",
      type: "INCOME",
      color: "oklch(80% 0.20 140)",
      icon: "briefcase",
    });
    expect(result.success).toBe(true);
  });
});

describe("categorySchema — invalid", () => {
  it("fails when name is empty", () => {
    const result = categorySchema.safeParse({
      name: "",
      type: "EXPENSE",
      color: "oklch(70% 0.15 200)",
      icon: "shopping-cart",
    });
    expect(result.success).toBe(false);
  });

  it("fails when name exceeds 64 characters", () => {
    const result = categorySchema.safeParse({
      name: "B".repeat(65),
      type: "EXPENSE",
      color: "oklch(70% 0.15 200)",
      icon: "shopping-cart",
    });
    expect(result.success).toBe(false);
  });

  it("fails for invalid type enum", () => {
    const result = categorySchema.safeParse({
      name: "Rent",
      type: "TRANSFER",
      color: "oklch(70% 0.15 200)",
      icon: "home",
    });
    expect(result.success).toBe(false);
  });

  it("fails for invalid color format", () => {
    const result = categorySchema.safeParse({
      name: "Rent",
      type: "EXPENSE",
      color: "rgb(255,0,0)",
      icon: "home",
    });
    expect(result.success).toBe(false);
  });

  it("fails when icon is missing", () => {
    const result = categorySchema.safeParse({
      name: "Rent",
      type: "EXPENSE",
      color: "oklch(70% 0.15 200)",
    });
    expect(result.success).toBe(false);
  });
});

// ── transactionSchema ──

const baseExpense = {
  type: "EXPENSE" as const,
  date: "2026-04-13",
  accountId: 1,
  categoryId: 2,
  currency: "USD",
  amount: 5000,
  amountMainCurrency: 5000,
  exchangeRate: 1,
  note: "",
  transferGroupId: null,
  transferDirection: null,
};

describe("transactionSchema — valid", () => {
  it("accepts a valid EXPENSE transaction", () => {
    const result = transactionSchema.safeParse(baseExpense);
    expect(result.success).toBe(true);
  });

  it("accepts a valid INCOME transaction", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      type: "INCOME",
      categoryId: 3,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid TRANSFER transaction with transferGroupId", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      type: "TRANSFER",
      categoryId: null,
      transferGroupId: "550e8400-e29b-41d4-a716-446655440000",
      transferDirection: "OUT",
      toAccountId: 2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a transaction with a note", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      note: "Monthly groceries",
    });
    expect(result.success).toBe(true);
  });
});

describe("transactionSchema — invalid", () => {
  it("fails when amount is zero (not positive)", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("fails when amount is negative", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      amount: -100,
    });
    expect(result.success).toBe(false);
  });

  it("fails for invalid date format (not YYYY-MM-DD)", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      date: "13/04/2026",
    });
    expect(result.success).toBe(false);
  });

  it("fails when accountId is missing", () => {
    const { accountId: _, ...withoutAccountId } = baseExpense;
    const result = transactionSchema.safeParse(withoutAccountId);
    expect(result.success).toBe(false);
  });

  it("fails for invalid transaction type", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      type: "DEBT_PAYMENT",
    });
    expect(result.success).toBe(false);
  });

  it("fails when transferGroupId is not a valid UUID", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      type: "TRANSFER",
      categoryId: null,
      transferGroupId: "not-a-uuid",
      transferDirection: "OUT",
    });
    expect(result.success).toBe(false);
  });

  it("fails when amountMainCurrency is negative", () => {
    const result = transactionSchema.safeParse({
      ...baseExpense,
      amountMainCurrency: -500,
    });
    expect(result.success).toBe(false);
  });
});

// ── budgetSchema ──

describe("budgetSchema — valid", () => {
  it("accepts a budget targeting a category", () => {
    const result = budgetSchema.safeParse({
      categoryId: 1,
      accountId: null,
      month: "2026-04",
      plannedAmount: 50000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a budget targeting an account", () => {
    const result = budgetSchema.safeParse({
      categoryId: null,
      accountId: 2,
      month: "2026-04",
      plannedAmount: 100000,
    });
    expect(result.success).toBe(true);
  });
});

describe("budgetSchema — invalid", () => {
  it("fails when plannedAmount is zero (not positive)", () => {
    const result = budgetSchema.safeParse({
      categoryId: 1,
      accountId: null,
      month: "2026-04",
      plannedAmount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("fails when plannedAmount is negative", () => {
    const result = budgetSchema.safeParse({
      categoryId: 1,
      accountId: null,
      month: "2026-04",
      plannedAmount: -500,
    });
    expect(result.success).toBe(false);
  });

  it("fails when month format is invalid (not YYYY-MM)", () => {
    const result = budgetSchema.safeParse({
      categoryId: 1,
      accountId: null,
      month: "2026/04",
      plannedAmount: 50000,
    });
    expect(result.success).toBe(false);
  });

  it("fails when both categoryId and accountId are set", () => {
    const result = budgetSchema.safeParse({
      categoryId: 1,
      accountId: 2,
      month: "2026-04",
      plannedAmount: 50000,
    });
    expect(result.success).toBe(false);
  });

  it("fails when both categoryId and accountId are null", () => {
    const result = budgetSchema.safeParse({
      categoryId: null,
      accountId: null,
      month: "2026-04",
      plannedAmount: 50000,
    });
    expect(result.success).toBe(false);
  });
});

// ── settingSchemas ──

describe("settingSchemas", () => {
  it("mainCurrency: accepts a 3-character code", () => {
    expect(settingSchemas.mainCurrency.safeParse("USD").success).toBe(true);
  });

  it("mainCurrency: rejects a 2-character code", () => {
    expect(settingSchemas.mainCurrency.safeParse("US").success).toBe(false);
  });

  it("language: accepts a 2-character code", () => {
    expect(settingSchemas.language.safeParse("en").success).toBe(true);
  });

  it("language: rejects an empty string", () => {
    expect(settingSchemas.language.safeParse("").success).toBe(false);
  });

  it("startupScreen: accepts a valid tab name", () => {
    expect(settingSchemas.startupScreen.safeParse("transactions").success).toBe(true);
  });

  it("startupScreen: rejects an unknown tab name", () => {
    expect(settingSchemas.startupScreen.safeParse("dashboard").success).toBe(false);
  });

  it("notificationEnabled: accepts a boolean", () => {
    expect(settingSchemas.notificationEnabled.safeParse(true).success).toBe(true);
  });

  it("notificationEnabled: rejects a string", () => {
    expect(settingSchemas.notificationEnabled.safeParse("true").success).toBe(false);
  });

  it("notificationTime: accepts HH:MM format", () => {
    expect(settingSchemas.notificationTime.safeParse("08:30").success).toBe(true);
  });

  it("notificationTime: rejects invalid time format", () => {
    expect(settingSchemas.notificationTime.safeParse("8:30").success).toBe(false);
  });

  it("autoBackupIntervalHours: accepts a positive integer", () => {
    expect(settingSchemas.autoBackupIntervalHours.safeParse(24).success).toBe(true);
  });

  it("autoBackupIntervalHours: accepts null (disabled)", () => {
    expect(settingSchemas.autoBackupIntervalHours.safeParse(null).success).toBe(true);
  });

  it("autoBackupIntervalHours: rejects zero", () => {
    expect(settingSchemas.autoBackupIntervalHours.safeParse(0).success).toBe(false);
  });
});

// ── backupAccountSchema — description length ──

const baseBackupAccount = {
  name: "Checking",
  type: "REGULAR" as const,
  color: "oklch(70% 0.15 200)",
  icon: "wallet",
  currency: "USD",
  description: "",
  balance: 0,
  startingBalance: 0,
  includeInTotal: true,
  isTrashed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("backupAccountSchema — description validation", () => {
  it("accepts a short description", () => {
    const result = backupAccountSchema.safeParse({
      ...baseBackupAccount,
      description: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty description", () => {
    const result = backupAccountSchema.safeParse({
      ...baseBackupAccount,
      description: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a description of exactly 255 characters", () => {
    const result = backupAccountSchema.safeParse({
      ...baseBackupAccount,
      description: "x".repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a description longer than 255 characters", () => {
    const result = backupAccountSchema.safeParse({
      ...baseBackupAccount,
      description: "x".repeat(256),
    });
    expect(result.success).toBe(false);
  });
});
