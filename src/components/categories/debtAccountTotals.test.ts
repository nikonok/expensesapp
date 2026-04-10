import { describe, it, expect } from 'vitest';
import { isDebtPayment } from '../../utils/transaction-utils';
import type { Transaction } from '../../db/models';

// This replicates the aggregation logic from CategoryList's useMemo so we
// can unit-test the bucketing rules without any component/Dexie setup.
function aggregateTransactions(transactions: Transaction[]) {
  const expenseById = new Map<number, number>();
  const incomeById = new Map<number, number>();
  const debtAccountTotals = new Map<number, number>();

  for (const tx of transactions) {
    if (isDebtPayment(tx) && tx.toAccountId != null) {
      debtAccountTotals.set(
        tx.toAccountId,
        (debtAccountTotals.get(tx.toAccountId) ?? 0) + tx.amountMainCurrency,
      );
    } else if (tx.categoryId !== null) {
      if (tx.type === 'EXPENSE') {
        expenseById.set(tx.categoryId, (expenseById.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
      } else if (tx.type === 'INCOME') {
        incomeById.set(tx.categoryId, (incomeById.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
      }
    }
  }
  return { expenseById, incomeById, debtAccountTotals };
}

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

describe('CategoryList aggregation — debtAccountTotals', () => {
  it('accumulates debt payment TRANSFER OUT into debtAccountTotals by toAccountId', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 200 }),
    ];
    const { debtAccountTotals } = aggregateTransactions(txs);
    expect(debtAccountTotals.get(5)).toBe(200);
  });

  it('sums multiple debt payments to the same account', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 150 }),
      makeTx({ id: 2, type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 75 }),
    ];
    const { debtAccountTotals } = aggregateTransactions(txs);
    expect(debtAccountTotals.get(5)).toBe(225);
  });

  it('buckets debt payments to different accounts independently', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 300 }),
      makeTx({ id: 2, type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 7, categoryId: null, amountMainCurrency: 50 }),
    ];
    const { debtAccountTotals } = aggregateTransactions(txs);
    expect(debtAccountTotals.get(5)).toBe(300);
    expect(debtAccountTotals.get(7)).toBe(50);
  });

  it('does not add TRANSFER IN (receiving leg) to debtAccountTotals', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'IN', toAccountId: null, categoryId: null, amountMainCurrency: 200 }),
    ];
    const { debtAccountTotals } = aggregateTransactions(txs);
    expect(debtAccountTotals.size).toBe(0);
  });

  it('does not add TRANSFER OUT without toAccountId to debtAccountTotals', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: null, categoryId: null, amountMainCurrency: 200 }),
    ];
    const { debtAccountTotals } = aggregateTransactions(txs);
    expect(debtAccountTotals.size).toBe(0);
  });

  it('does not double-count a debt payment into expenseById', () => {
    const txs = [
      makeTx({ type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 200 }),
    ];
    const { expenseById } = aggregateTransactions(txs);
    expect(expenseById.size).toBe(0);
  });

  it('still accumulates regular EXPENSE transactions into expenseById', () => {
    const txs = [
      makeTx({ type: 'EXPENSE', categoryId: 3, amountMainCurrency: 50 }),
    ];
    const { expenseById, debtAccountTotals } = aggregateTransactions(txs);
    expect(expenseById.get(3)).toBe(50);
    expect(debtAccountTotals.size).toBe(0);
  });

  it('still accumulates INCOME transactions into incomeById', () => {
    const txs = [
      makeTx({ type: 'INCOME', categoryId: 4, amountMainCurrency: 1000 }),
    ];
    const { incomeById, debtAccountTotals } = aggregateTransactions(txs);
    expect(incomeById.get(4)).toBe(1000);
    expect(debtAccountTotals.size).toBe(0);
  });

  it('handles a mixed set of transactions correctly', () => {
    const txs = [
      makeTx({ id: 1, type: 'EXPENSE', categoryId: 3, amountMainCurrency: 80 }),
      makeTx({ id: 2, type: 'INCOME', categoryId: 4, amountMainCurrency: 500 }),
      makeTx({ id: 3, type: 'TRANSFER', transferDirection: 'OUT', toAccountId: 5, categoryId: null, amountMainCurrency: 120 }),
      makeTx({ id: 4, type: 'TRANSFER', transferDirection: 'IN', toAccountId: null, categoryId: null, amountMainCurrency: 120 }),
    ];
    const { expenseById, incomeById, debtAccountTotals } = aggregateTransactions(txs);
    expect(expenseById.get(3)).toBe(80);
    expect(incomeById.get(4)).toBe(500);
    expect(debtAccountTotals.get(5)).toBe(120);
    expect(debtAccountTotals.size).toBe(1);
  });
});

describe('CategoryList aggregation — debtAccountsWithSpend filter', () => {
  // Replicates the debtAccountsWithSpend memo logic:
  // filter DEBT accounts where debtAccountTotals.get(a.id) > 0, EXPENSE view only

  function getDebtAccountsWithSpend(
    accounts: Array<{ id: number; type: string }>,
    totals: Map<number, number>,
    viewType: 'EXPENSE' | 'INCOME',
  ) {
    if (viewType !== 'EXPENSE') return [];
    return accounts
      .filter((a) => a.type === 'DEBT' && (totals.get(a.id) ?? 0) > 0)
      .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0));
  }

  it('returns only DEBT accounts with spend > 0 in EXPENSE view', () => {
    const accounts = [
      { id: 1, type: 'DEBT' },
      { id: 2, type: 'DEBT' },
      { id: 3, type: 'REGULAR' },
    ];
    const totals = new Map([[1, 300], [3, 100]]);
    const result = getDebtAccountsWithSpend(accounts, totals, 'EXPENSE');
    expect(result.map((a) => a.id)).toEqual([1]);
  });

  it('sorts by descending spend amount', () => {
    const accounts = [
      { id: 1, type: 'DEBT' },
      { id: 2, type: 'DEBT' },
    ];
    const totals = new Map([[1, 100], [2, 400]]);
    const result = getDebtAccountsWithSpend(accounts, totals, 'EXPENSE');
    expect(result.map((a) => a.id)).toEqual([2, 1]);
  });

  it('returns empty array in INCOME view even if debt accounts have spend', () => {
    const accounts = [{ id: 1, type: 'DEBT' }];
    const totals = new Map([[1, 200]]);
    const result = getDebtAccountsWithSpend(accounts, totals, 'INCOME');
    expect(result).toEqual([]);
  });

  it('excludes DEBT accounts with zero spend', () => {
    const accounts = [{ id: 1, type: 'DEBT' }];
    const totals = new Map<number, number>();
    const result = getDebtAccountsWithSpend(accounts, totals, 'EXPENSE');
    expect(result).toEqual([]);
  });
});
