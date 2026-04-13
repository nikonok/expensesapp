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

// ── DOM helpers ───────────────────────────────────────────────────────────────

function setupDomMocks() {
  const clickMock = vi.fn();
  const anchor = { href: '', download: '', click: clickMock } as unknown as HTMLAnchorElement;
  vi.spyOn(document, 'createElement').mockReturnValue(anchor);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { anchor, clickMock };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let mockTxQuery: { between: ReturnType<typeof vi.fn>; sortBy: ReturnType<typeof vi.fn> };

beforeEach(() => {
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

  setupDomMocks();
});

// ── Helper to get aoa_to_sheet call data ──────────────────────────────────────

async function getSheetData(): Promise<(string | number)[][]> {
  const XLSX = await import('xlsx');
  return vi.mocked(XLSX.utils.aoa_to_sheet).mock.calls[0][0] as (string | number)[][];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('exportService.exportTransactions', () => {
  describe('amount conversion (integer minor units)', () => {
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

    it('writes transfer OUT/IN amounts as amountMainCurrency / 100', async () => {
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
      // Row 1: OUT leg → expense col = 5000 / 100 = 50
      // Row 2: IN leg  → income col = 7500 / 100 = 75
      expect(sheetData[1][3]).toBe(50);   // OUT: expense col
      expect(sheetData[1][2]).toBe('');   // OUT: income col empty
      expect(sheetData[2][2]).toBe(75);   // IN: 7500 / 100
      expect(sheetData[2][3]).toBe('');   // IN: expense col empty
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

  describe('trashed transaction filtering', () => {
    it('excludes isTrashed transactions from XLSX output', async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ id: 1, amountMainCurrency: 5000, isTrashed: false }),
        makeTx({ id: 2, amountMainCurrency: 20000, isTrashed: true }),
      ]);

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const sheetData = await getSheetData();
      const dataRows = sheetData.slice(1);
      expect(dataRows).toHaveLength(1);
      expect(dataRows[0]).toContain(50);    // 5000 / 100
      expect(dataRows[0]).not.toContain(200); // 20000 / 100 should not appear
    });

    it('produces zero data rows when all transactions are trashed', async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ id: 1, isTrashed: true }),
        makeTx({ id: 2, isTrashed: true }),
      ]);

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const sheetData = await getSheetData();
      expect(sheetData.slice(1)).toHaveLength(0);
    });
  });

  describe('transfer deduplication', () => {
    it('emits exactly two rows for a transfer pair (not four)', async () => {
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
  });

  describe('date range filtering', () => {
    it('queries Dexie with the provided start and end date strings (inclusive)', async () => {
      await exportService.exportTransactions('2026-03-01', '2026-03-31', 'EUR');

      expect(vi.mocked(db.transactions.where)).toHaveBeenCalledWith('date');
      expect(mockTxQuery.between).toHaveBeenCalledWith('2026-03-01', '2026-03-31', true, true);
    });
  });

  describe('browser download trigger', () => {
    it('creates an anchor element and calls click() to initiate download', async () => {
      mockTxQuery.sortBy.mockResolvedValue([makeTx({ id: 1 })]);

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(vi.mocked(document.createElement as any).mock.results[0].value.click)
        .toHaveBeenCalledTimes(1);
    });

    it('sets the correct download filename', async () => {
      const clickMock = vi.fn();
      const anchor = { href: '', download: '', click: clickMock } as unknown as HTMLAnchorElement;
      vi.spyOn(document, 'createElement').mockReturnValue(anchor);

      mockTxQuery.sortBy.mockResolvedValue([makeTx({ id: 1 })]);

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      expect(anchor.download).toBe('expenses_2026-04-01_to_2026-04-30.xlsx');
    });
  });

  describe('formula injection sanitization', () => {
    it('sanitizes = prefix injection strings in note field', async () => {
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
  });

  describe('date formatting', () => {
    it('formats dates as DD.MM.YYYY', async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: 'EXPENSE', date: '2026-01-15', amountMainCurrency: 1000 }),
      ]);

      await exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD');

      const sheetData = await getSheetData();
      // col index 0 = date
      expect(sheetData[1][0]).toBe('15.01.2026');
    });
  });

  describe('header row', () => {
    it('includes the main currency in income and expense column headers', async () => {
      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'JPY');

      const sheetData = await getSheetData();
      const header = sheetData[0] as string[];
      expect(header).toContain('Income (JPY)');
      expect(header).toContain('Expense (JPY)');
    });

    it('includes all six columns in the correct order', async () => {
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
  });

  describe('name resolution', () => {
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
  });

  describe('error handling', () => {
    it('re-throws on DB error', async () => {
      mockTxQuery.sortBy.mockRejectedValue(new Error('DB read failed'));

      await expect(
        exportService.exportTransactions('2026-01-01', '2026-01-31', 'USD'),
      ).rejects.toThrow('DB read failed');
    });
  });
});
