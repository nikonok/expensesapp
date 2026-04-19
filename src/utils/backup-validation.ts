import { z } from "zod";

// ── Shared helpers ──

const backupId = z.number().int().positive().optional();
const isoDateTime = z.string();
const isoDate = z.string();

// ── Account ──

export const backupAccountSchema = z
  .object({
    id: backupId,
    name: z.string(),
    type: z.enum(["REGULAR", "DEBT", "SAVINGS"]),
    color: z.string(),
    icon: z.string(),
    currency: z.string(),
    description: z.string().max(255),
    balance: z.number().int().finite(),
    startingBalance: z.number().int().finite(),
    includeInTotal: z.boolean(),
    isTrashed: z.boolean(),

    // Savings-specific
    savingsGoal: z.number().int().finite().nonnegative().nullable().optional(),
    savingsInterestRate: z.number().finite().nullable().optional(),

    // Debt-specific
    interestRateMonthly: z.number().finite().nullable().optional(),
    interestRateYearly: z.number().finite().nullable().optional(),
    debtOriginalAmount: z.number().int().finite().nonnegative().nullable().optional(),
    mortgageLoanAmount: z.number().int().finite().nonnegative().nullable().optional(),
    mortgageStartDate: isoDate.nullable().optional(),
    mortgageTermYears: z.number().int().finite().nonnegative().nullable().optional(),
    mortgageInterestRate: z.number().finite().nullable().optional(),

    // Future feature stub
    autoAccrueInterest: z.boolean().optional(),

    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });

// ── Category ──

export const backupCategorySchema = z
  .object({
    id: backupId,
    name: z.string(),
    type: z.enum(["EXPENSE", "INCOME"]),
    color: z.string(),
    icon: z.string(),
    displayOrder: z.number().int().finite(),
    isTrashed: z.boolean(),

    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });

// ── Transaction ──

const recurringRuleSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    endDate: isoDate.optional(),
  });

export const backupTransactionSchema = z
  .object({
    id: backupId,
    type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
    date: isoDate,
    timestamp: isoDateTime,
    displayOrder: z.number().int().finite(),

    accountId: z.number().int().positive(),
    categoryId: z.number().int().positive().nullable(),

    currency: z.string(),

    amount: z.number().int().finite().nonnegative(),
    amountMainCurrency: z.number().int().finite().nonnegative(),
    exchangeRate: z.number().nonnegative().finite(),

    note: z.string(),
    isTrashed: z.boolean().optional(),

    // Transfer-specific
    transferGroupId: z.string().nullable(),
    transferDirection: z.enum(["OUT", "IN"]).nullable(),

    // Debt payment metadata
    toAccountId: z.number().int().positive().nullable().optional(),
    interestAmount: z.number().int().finite().nonnegative().nullable().optional(),
    principalAmount: z.number().int().finite().nonnegative().nullable().optional(),
    isOverpayment: z.boolean().nullable().optional(),

    // Future feature stub
    recurringRule: recurringRuleSchema.nullable().optional(),

    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });

// ── Budget ──

export const backupBudgetSchema = z
  .object({
    id: backupId,
    categoryId: z.number().int().positive().nullable(),
    accountId: z.number().int().positive().nullable(),
    month: z.string(),
    plannedAmount: z.number().int().finite().nonnegative(),

    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });

// ── Exchange Rate Cache ──

export const backupExchangeRateSchema = z
  .object({
    id: backupId,
    baseCurrency: z.string(),
    date: isoDate,
    rates: z.record(z.string(), z.number().finite()),
    fetchedAt: isoDateTime,
  });

// ── Setting ──
// Primary key is `key: string` — no `id` field.

export const backupSettingSchema = z
  .object({
    key: z.string().min(1),
    value: z.unknown(),
  });
