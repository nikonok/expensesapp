import { describe, it, expect } from 'vitest';
import { isDebtPayment, isExpenseForReporting, getDayTotals } from '../transaction-utils';
import type { Transaction } from '../../db/models';

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1,
    type: 'EXPENSE',
    date: '2026-04-13',
    timestamp: '2026-04-13T10:00:00.000Z',
    displayOrder: 0,
    accountId: 1,
    categoryId: 1,
    currency: 'USD',
    amount: 1000,
    amountMainCurrency: 1000,
    exchangeRate: 1,
    note: '',
    transferGroupId: null,
    transferDirection: null,
    toAccountId: null,
    createdAt: '2026-04-13T10:00:00.000Z',
    updatedAt: '2026-04-13T10:00:00.000Z',
    ...overrides,
  };
}

// ── isDebtPayment ──

describe('isDebtPayment', () => {
  it('returns true for a TRANSFER OUT with a toAccountId (debt payment)', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 2 });
    expect(isDebtPayment(tx)).toBe(true);
  });

  it('returns false for a TRANSFER IN leg (not the payer side)', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'IN', toAccountId: null });
    expect(isDebtPayment(tx)).toBe(false);
  });

  it('returns false for a TRANSFER OUT with no toAccountId (regular transfer)', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null });
    expect(isDebtPayment(tx)).toBe(false);
  });

  it('returns false for an EXPENSE transaction', () => {
    const tx = makeTx({ type: 'EXPENSE' });
    expect(isDebtPayment(tx)).toBe(false);
  });

  it('returns false for an INCOME transaction', () => {
    const tx = makeTx({ type: 'INCOME' });
    expect(isDebtPayment(tx)).toBe(false);
  });
});

// ── isExpenseForReporting ──

describe('isExpenseForReporting', () => {
  it('returns true for an EXPENSE transaction', () => {
    const tx = makeTx({ type: 'EXPENSE' });
    expect(isExpenseForReporting(tx)).toBe(true);
  });

  it('returns true for a debt payment (TRANSFER OUT to debt account)', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 3 });
    expect(isExpenseForReporting(tx)).toBe(true);
  });

  it('returns false for an INCOME transaction', () => {
    const tx = makeTx({ type: 'INCOME' });
    expect(isExpenseForReporting(tx)).toBe(false);
  });

  it('returns false for a regular TRANSFER OUT (no toAccountId)', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null });
    expect(isExpenseForReporting(tx)).toBe(false);
  });

  it('returns false for a TRANSFER IN leg', () => {
    const tx = makeTx({ type: 'TRANSFER', transferDirection: 'IN', toAccountId: null });
    expect(isExpenseForReporting(tx)).toBe(false);
  });
});

// ── getDayTotals ──

describe('getDayTotals', () => {
  it('returns zero income and zero expense for an empty array', () => {
    expect(getDayTotals([])).toEqual({ income: 0, expense: 0 });
  });

  it('sums INCOME transactions into income total', () => {
    const txs = [
      makeTx({ type: 'INCOME', amountMainCurrency: 200000 }),
      makeTx({ type: 'INCOME', amountMainCurrency: 50000 }),
    ];
    expect(getDayTotals(txs)).toEqual({ income: 250000, expense: 0 });
  });

  it('sums EXPENSE transactions into expense total', () => {
    const txs = [
      makeTx({ type: 'EXPENSE', amountMainCurrency: 3000 }),
      makeTx({ type: 'EXPENSE', amountMainCurrency: 7000 }),
    ];
    expect(getDayTotals(txs)).toEqual({ income: 0, expense: 10000 });
  });

  it('counts debt payments (TRANSFER OUT with toAccountId) as expense', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 2, amountMainCurrency: 15000 }),
    ];
    expect(getDayTotals(txs)).toEqual({ income: 0, expense: 15000 });
  });

  it('does not count regular TRANSFER legs in either total', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null, amountMainCurrency: 5000 }),
      makeTx({ type: 'TRANSFER', transferDirection: 'IN', toAccountId: null, amountMainCurrency: 5000 }),
    ];
    expect(getDayTotals(txs)).toEqual({ income: 0, expense: 0 });
  });

  it('handles a mixed set of income, expense, debt payment, and transfer', () => {
    const txs = [
      makeTx({ type: 'INCOME', amountMainCurrency: 100000 }),
      makeTx({ type: 'EXPENSE', amountMainCurrency: 20000 }),
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 2, amountMainCurrency: 5000 }),
      makeTx({ type: 'TRANSFER', transferDirection: 'IN', toAccountId: null, amountMainCurrency: 5000 }),
    ];
    expect(getDayTotals(txs)).toEqual({ income: 100000, expense: 25000 });
  });
});
