// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

vi.mock('../db/database', () => ({
  db: {
    transactions: {
      where: vi.fn(),
    },
    accounts: { toArray: vi.fn() },
    categories: { toArray: vi.fn() },
  },
}));

vi.mock('./notification.service', () => ({
  notificationService: { sendNotification: vi.fn() },
}));

vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({ mock: 'sheet' })),
    book_new: vi.fn(() => ({ mock: 'workbook' })),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { db } from '../db/database';
import { notificationService } from './notification.service';
import { exportService } from './export.service';
import type { Transaction } from '../db/models';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: 'EXPENSE',
    date: '2026-01-15',
    timestamp: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let mockTxQuery: { between: ReturnType<typeof vi.fn>; sortBy: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.clearAllMocks();

  mockTxQuery = {
    between: vi.fn().mockReturnThis(),
    sortBy: vi.fn().mockResolvedValue([]),
  };
  vi.mocked(db.transactions.where).mockReturnValue(mockTxQuery as any);

  vi.mocked(db.accounts.toArray).mockResolvedValue([
    { id: 1, name: 'Checking', type: 'REGULAR', color: '', icon: '', currency: 'USD',
      description: '', balance: 0, startingBalance: 0, includeInTotal: true, isTrashed: false,
      createdAt: '', updatedAt: '' },
    { id: 2, name: 'Savings', type: 'REGULAR', color: '', icon: '', currency: 'USD',
      description: '', balance: 0, startingBalance: 0, includeInTotal: true, isTrashed: false,
      createdAt: '', updatedAt: '' },
  ]);

  vi.mocked(db.categories.toArray).mockResolvedValue([
    { id: 1, name: 'Food', type: 'EXPENSE', color: '', icon: '', displayOrder: 0,
      isTrashed: false, createdAt: '', updatedAt: '' },
  ]);
});

// ── Helper to get aoa_to_sheet call data ──────────────────────────────────────

async function getSheetData(): Promise<(string | number)[][]> {
  const XLSX = await import('xlsx');
  return vi.mocked(XLSX.utils.aoa_to_sheet).mock.calls[0][0] as (string | number)[][];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('exportService.exportTransactions', () => {
  it('writes income amount as amountMainCurrency / 100', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'INCOME', amountMainCurrency: 1050, accountId: 1, categoryId: 1 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // row index 1 (after header), col index 2 = income, col index 3 = expense
    expect(sheetData[1][2]).toBe(10.5);  // 1050 / 100
    expect(sheetData[1][3]).toBe('');    // expense col is empty for INCOME
  });

  it('writes expense amount as amountMainCurrency / 100', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', amountMainCurrency: 2000, accountId: 1, categoryId: 1 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    expect(sheetData[1][3]).toBe(20);   // 2000 / 100
    expect(sheetData[1][2]).toBe('');   // income col is empty for EXPENSE
  });

  it('writes transfer IN amount as amountMainCurrency / 100', async () => {
    const groupId = 'transfer-group-uuid';
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({
        id: 10,
        type: 'TRANSFER',
        transferGroupId: groupId,
        transferDirection: 'OUT',
        amountMainCurrency: 5000,
        accountId: 1,
        categoryId: null,
      }),
      makeTx({
        id: 11,
        type: 'TRANSFER',
        transferGroupId: groupId,
        transferDirection: 'IN',
        amountMainCurrency: 7500,
        accountId: 2,
        categoryId: null,
      }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // Row 1: OUT leg (expense col = amountMainCurrency / 100 = 50)
    // Row 2: IN leg (income col = amountMainCurrency / 100 = 75)
    expect(sheetData[1][3]).toBe(50);   // OUT: expense col
    expect(sheetData[1][2]).toBe('');   // OUT: income col empty
    expect(sheetData[2][2]).toBe(75);   // IN: 7500 / 100
    expect(sheetData[2][3]).toBe('');   // IN: expense col empty
  });

  it('sanitizes formula-injection strings in note field', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', note: '=SUM(A1)', amountMainCurrency: 1000 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // col index 1 = note
    expect(sheetData[1][1]).toBe("'=SUM(A1)");
  });

  it('sanitizes + prefix injection strings', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', note: '+CMD', amountMainCurrency: 500 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    expect(sheetData[1][1]).toBe("'+CMD");
  });

  it('sanitizes - prefix injection strings', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', note: '-1+2', amountMainCurrency: 500 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    expect(sheetData[1][1]).toBe("'-1+2");
  });

  it('formats dates as DD.MM.YYYY', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', date: '2026-01-15', amountMainCurrency: 1000 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // col index 0 = date
    expect(sheetData[1][0]).toBe('15.01.2026');
  });

  it('includes header row as first row with currency-templated columns', async () => {
    mockTxQuery.sortBy.mockResolvedValue([]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'EUR');

    const sheetData = await getSheetData();
    expect(sheetData[0]).toEqual([
      'Date (dd.mm.yyyy)',
      'Note',
      'Income (EUR)',
      'Expense (EUR)',
      'Category',
      'Account',
    ]);
  });

  it('includes header with correct mainCurrency substitution', async () => {
    mockTxQuery.sortBy.mockResolvedValue([]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'PLN');

    const sheetData = await getSheetData();
    expect(sheetData[0][2]).toBe('Income (PLN)');
    expect(sheetData[0][3]).toBe('Expense (PLN)');
  });

  it('calls notificationService.sendNotification on success', async () => {
    mockTxQuery.sortBy.mockResolvedValue([]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    expect(notificationService.sendNotification).toHaveBeenCalledOnce();
    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      'Export complete',
      'Your file has been downloaded.',
    );
  });

  it('re-throws on DB error', async () => {
    mockTxQuery.sortBy.mockRejectedValue(new Error('DB read failed'));

    await expect(
      exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD'),
    ).rejects.toThrow('DB read failed');
  });

  it('deduplicates transfer pair — emits exactly two rows for one transfer group', async () => {
    const groupId = 'dedup-group-uuid';
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({
        id: 20,
        type: 'TRANSFER',
        transferGroupId: groupId,
        transferDirection: 'OUT',
        amountMainCurrency: 3000,
        accountId: 1,
        categoryId: null,
      }),
      makeTx({
        id: 21,
        type: 'TRANSFER',
        transferGroupId: groupId,
        transferDirection: 'IN',
        amountMainCurrency: 3000,
        accountId: 2,
        categoryId: null,
      }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // header + 2 data rows (OUT + IN), not 4
    expect(sheetData).toHaveLength(3);
  });

  it('resolves account name in the account column', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', accountId: 2, amountMainCurrency: 500 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // col index 5 = account
    expect(sheetData[1][5]).toBe('Savings');
  });

  it('resolves category name in the category column', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', categoryId: 1, amountMainCurrency: 500 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    // col index 4 = category
    expect(sheetData[1][4]).toBe('Food');
  });

  it('amountMainCurrency=1 → spreadsheet value 0.01 (integer minor unit boundary)', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'INCOME', amountMainCurrency: 1 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    expect(sheetData[1][2]).toBe(0.01);
  });

  it('amountMainCurrency=100000 → spreadsheet value 1000 (large integer)', async () => {
    mockTxQuery.sortBy.mockResolvedValue([
      makeTx({ type: 'EXPENSE', amountMainCurrency: 100000 }),
    ]);

    await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

    const sheetData = await getSheetData();
    expect(sheetData[1][3]).toBe(1000);
  });
});
