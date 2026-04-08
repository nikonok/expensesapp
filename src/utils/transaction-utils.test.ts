import { describe, it, expect } from 'vitest';
import { isDebtPayment, isExpenseForReporting } from './transaction-utils';
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
