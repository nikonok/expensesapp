import { describe, it, expect } from 'vitest';
import { isDebtPayment, isExpenseForReporting, getDayTotals } from './transaction-utils';
import type { Transaction } from '../db/models';

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1,
    type: 'EXPENSE',
    date: '2026-01-01',
    timestamp: '2026-01-01T00:00:00.000Z',
    displayOrder: 0,
    accountId: 1,
    categoryId: 1,
    currency: 'USD',
    amount: 100,
    amountMainCurrency: 100,
    exchangeRate: 1,
    note: '',
    transferGroupId: null,
    transferDirection: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isDebtPayment', () => {
  it('returns true for TRANSFER OUT with toAccountId set', () => {
    expect(
      isDebtPayment(makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null })),
    ).toBe(true);
  });

  it('returns false for TRANSFER IN (the other leg)', () => {
    expect(
      isDebtPayment(makeTx({ type: 'TRANSFER', transferDirection: 'IN', toAccountId: null, categoryId: null })),
    ).toBe(false);
  });

  it('returns false for regular TRANSFER OUT (no toAccountId)', () => {
    expect(
      isDebtPayment(makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null, categoryId: null })),
    ).toBe(false);
  });

  it('returns false for regular EXPENSE', () => {
    expect(isDebtPayment(makeTx({ type: 'EXPENSE' }))).toBe(false);
  });

  it('returns false for INCOME', () => {
    expect(isDebtPayment(makeTx({ type: 'INCOME', categoryId: 2 }))).toBe(false);
  });
});

describe('isExpenseForReporting', () => {
  it('returns true for EXPENSE', () => {
    expect(isExpenseForReporting(makeTx({ type: 'EXPENSE' }))).toBe(true);
  });

  it('returns true for debt payment TRANSFER OUT', () => {
    expect(
      isExpenseForReporting(
        makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 3, categoryId: null }),
      ),
    ).toBe(true);
  });

  it('returns false for INCOME', () => {
    expect(isExpenseForReporting(makeTx({ type: 'INCOME', categoryId: 2 }))).toBe(false);
  });

  it('returns false for regular TRANSFER OUT', () => {
    expect(
      isExpenseForReporting(
        makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null, categoryId: null }),
      ),
    ).toBe(false);
  });

  it('returns false for TRANSFER IN', () => {
    expect(
      isExpenseForReporting(
        makeTx({ type: 'TRANSFER', transferDirection: 'IN', categoryId: null }),
      ),
    ).toBe(false);
  });
});

describe('getDayTotals', () => {
  it('returns zeros for empty array', () => {
    expect(getDayTotals([])).toEqual({ income: 0, expense: 0 });
  });

  it('sums amountMainCurrency (not amount) for INCOME transactions', () => {
    const tx = makeTx({ type: 'INCOME', categoryId: 2, amount: 50, amountMainCurrency: 200 });
    expect(getDayTotals([tx])).toEqual({ income: 200, expense: 0 });
  });

  it('sums amountMainCurrency (not amount) for EXPENSE transactions', () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 50, amountMainCurrency: 150 });
    expect(getDayTotals([tx])).toEqual({ income: 0, expense: 150 });
  });

  it('excludes regular TRANSFER transactions', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null, categoryId: null, amountMainCurrency: 300 });
    expect(getDayTotals([tx])).toEqual({ income: 0, expense: 0 });
  });

  it('includes debt payment TRANSFER OUT as expense', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 120 });
    expect(getDayTotals([tx])).toEqual({ income: 0, expense: 120 });
  });

  it('sums income and expense together for a mixed day', () => {
    const income = makeTx({ type: 'INCOME', categoryId: 2, amountMainCurrency: 500 });
    const expense = makeTx({ type: 'EXPENSE', amountMainCurrency: 80 });
    const transfer = makeTx({ type: 'TRANSFER', transferDirection: 'IN', categoryId: null, amountMainCurrency: 999 });
    expect(getDayTotals([income, expense, transfer])).toEqual({ income: 500, expense: 80 });
  });
});
