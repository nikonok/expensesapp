import { z } from "zod";

export const accountSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  type: z.enum(["REGULAR", "DEBT", "SAVINGS"]),
  color: z.string().regex(/^oklch\([\d.]+%\s+[\d.]+\s+[\d.]+\)$/, "Invalid color format"),
  icon: z.string(),
  currency: z.string().length(3),
  description: z.string().max(255).default(""),
  balance: z.number().int().finite().optional(),
  startingBalance: z.number().int().finite(),
  includeInTotal: z.boolean().default(true),
  savingsGoal: z.number().int().positive().nullable().optional(),
  savingsInterestRate: z.number().min(0).max(1).nullable().optional(),
  debtOriginalAmount: z.number().int().positive().nullable().optional(),
  mortgageLoanAmount: z.number().int().positive().nullable().optional(),
  mortgageStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  mortgageTermYears: z.number().positive().int().nullable().optional(),
  mortgageInterestRate: z.number().min(0).max(1).nullable().optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  type: z.enum(["EXPENSE", "INCOME"]),
  color: z.string().regex(/^oklch\([\d.]+%\s+[\d.]+\s+[\d.]+\)$/, "Invalid color format"),
  icon: z.string(),
});

export const transactionSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable(),
  currency: z.string().length(3),
  amount: z.number().int().positive().finite(),
  amountMainCurrency: z.number().int().positive().finite(),
  exchangeRate: z.number().positive().finite(),
  note: z.string().max(255).default(""),
  transferGroupId: z.string().uuid().nullable().optional(),
  transferDirection: z.enum(["OUT", "IN"]).nullable().optional(),
  toAccountId: z.number().int().positive().nullable().optional(),
  interestAmount: z.number().int().finite().nullable().optional(),
  principalAmount: z.number().int().finite().nullable().optional(),
  isOverpayment: z.boolean().nullable().optional(),
});

export const budgetSchema = z
  .object({
    categoryId: z.number().int().positive().nullable(),
    accountId: z.number().int().positive().nullable(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    plannedAmount: z.number().int().positive().finite(),
  })
  .refine((data) => (data.categoryId != null) !== (data.accountId != null), {
    message: "Budget must target exactly one of categoryId or accountId",
  });

export const settingSchemas = {
  mainCurrency: z.string().length(3),
  language: z.string().min(2).max(10),
  startupScreen: z.enum(["accounts", "categories", "transactions", "budget", "overview"]),
  notificationEnabled: z.boolean(),
  notificationTime: z.string().regex(/^\d{2}:\d{2}$/),
  autoBackupIntervalHours: z.number().positive().int().nullable(),
  logLevel: z.enum(['all', 'errors']),
};
