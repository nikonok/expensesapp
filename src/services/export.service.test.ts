/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction, Account, Category } from '@/db/models';

// ── Mock xlsx (dynamic import inside the service) ──────────────────────────

vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn(() => new Uint8Array()),
}));

// ── Shared mutable state for DB mock ──────────────────────────────────────

const dbState = {
  transactions: [] as Transaction[],
  accounts: [] as Account[],
  categories: [] as Category[],
};

// Hoist mock functions so they are available inside vi.mock() factory closures
const { mockBetween, mockWhere } = vi.hoisted(() => {
  const mockBetween = vi.fn();
  const mockWhere = vi.fn();
  return { mockBetween, mockWhere };
});

vi.mock('@/db/database', () => ({
  db: {
    transactions: {
      where: mockWhere,
    },
    accounts: {
      toArray: vi.fn(() => Promise.resolve(dbState.accounts)),
    },
    categories: {
      toArray: vi.fn(() => Promise.resolve(dbState.categories)),
    },
  },
}));

// ── Import the module under test (after all vi.mock calls) ─────────────────

import { exportService } from './export.service';
import * as xlsxModule from 'xlsx';

// ── Factory helpers ────────────────────────────────────────────────────────

let nextId = 1;
let nextAccountId = 100;

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId++,
    type: 'EXPENSE',
    date: '2026-04-10',
    timestamp: new Date().toISOString(),
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
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Transaction;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: nextAccountId++,
    name: 'Test Account',
    type: 'REGULAR',
    color: 'oklch(0.7 0.2 180)',
    icon: 'wallet',
    currency: 'USD',
    description: '',
    balance: 1000,
    startingBalance: 1000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name: 'Food',
    type: 'EXPENSE',
    color: 'oklch(0.6 0.15 30)',
    icon: 'utensils',
    displayOrder: 0,
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── DOM helpers ────────────────────────────────────────────────────────────

function setupDomMocks() {
  const clickMock = vi.fn();
  const anchor = { href: '', download: '', click: clickMock } as unknown as HTMLAnchorElement;
  vi.spyOn(document, 'createElement').mockReturnValue(anchor);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { anchor, clickMock };
}

// ── Test setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.transactions = [];
  dbState.accounts = [];
  dbState.categories = [];
  nextId = 1;
  nextAccountId = 100;
  vi.clearAllMocks();
  // Wire (or re-wire after clearAllMocks) the mock chain
  mockBetween.mockReturnValue({
    sortBy: vi.fn(() => Promise.resolve(dbState.transactions)),
  });
  mockWhere.mockReturnValue({ between: mockBetween });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('exportService.exportTransactions', () => {
  describe('trashed transaction filtering', () => {
    it('excludes isTrashed transactions from XLSX output', async () => {
      setupDomMocks();
      dbState.transactions = [
        makeTx({ id: 1, amountMainCurrency: 50, isTrashed: false }),
        makeTx({ id: 2, amountMainCurrency: 200, isTrashed: true }),
      ];
      dbState.accounts = [makeAccount({ id: 1 })];
      dbState.categories = [makeCategory({ id: 1 })];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      const dataRows = aoaArg.slice(1);
      expect(dataRows).toHaveLength(1);
      expect(dataRows[0]).toContain(50);
      expect(dataRows[0]).not.toContain(200);
    });

    it('produces zero data rows when all transactions are trashed', async () => {
      setupDomMocks();
      dbState.transactions = [
        makeTx({ id: 1, isTrashed: true }),
        makeTx({ id: 2, isTrashed: true }),
      ];
      dbState.accounts = [makeAccount()];
      dbState.categories = [makeCategory()];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      expect(aoaArg.slice(1)).toHaveLength(0);
    });
  });

  describe('transaction type coverage', () => {
    it('includes both EXPENSE and INCOME rows', async () => {
      setupDomMocks();
      dbState.transactions = [
        makeTx({ id: 1, type: 'EXPENSE', amountMainCurrency: 100 }),
        makeTx({ id: 2, type: 'INCOME', amountMainCurrency: 200 }),
      ];
      dbState.accounts = [makeAccount({ id: 1 })];
      dbState.categories = [makeCategory({ id: 1 })];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      expect(aoaArg.slice(1)).toHaveLength(2);
    });

    it('places EXPENSE amount in column index 3 and leaves income column (index 2) empty', async () => {
      setupDomMocks();
      dbState.transactions = [makeTx({ id: 1, type: 'EXPENSE', amountMainCurrency: 75 })];
      dbState.accounts = [makeAccount({ id: 1 })];
      dbState.categories = [makeCategory({ id: 1 })];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      const row = aoaArg[1] as unknown[];
      expect(row[2]).toBe('');
      expect(row[3]).toBe(75);
    });

    it('places INCOME amount in column index 2 and leaves expense column (index 3) empty', async () => {
      setupDomMocks();
      dbState.transactions = [makeTx({ id: 1, type: 'INCOME', amountMainCurrency: 300 })];
      dbState.accounts = [makeAccount({ id: 1 })];
      dbState.categories = [makeCategory({ id: 1 })];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      const row = aoaArg[1] as unknown[];
      expect(row[2]).toBe(300);
      expect(row[3]).toBe('');
    });
  });

  describe('transfer deduplication', () => {
    it('emits exactly two rows for a transfer pair (not four)', async () => {
      setupDomMocks();
      const groupId = 'transfer-group-uuid-001';
      dbState.transactions = [
        makeTx({
          id: 10,
          type: 'TRANSFER',
          transferGroupId: groupId,
          transferDirection: 'OUT',
          accountId: 1,
          amountMainCurrency: 500,
        }),
        makeTx({
          id: 11,
          type: 'TRANSFER',
          transferGroupId: groupId,
          transferDirection: 'IN',
          accountId: 2,
          amountMainCurrency: 500,
        }),
      ];
      dbState.accounts = [
        makeAccount({ id: 1, name: 'Wallet' }),
        makeAccount({ id: 2, name: 'Savings' }),
      ];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      expect(aoaArg.slice(1)).toHaveLength(2);
    });

    it('OUT row uses expense column; IN row uses income column', async () => {
      setupDomMocks();
      const groupId = 'transfer-group-uuid-002';
      dbState.transactions = [
        makeTx({
          id: 20,
          type: 'TRANSFER',
          transferGroupId: groupId,
          transferDirection: 'OUT',
          accountId: 1,
          amountMainCurrency: 250,
        }),
        makeTx({
          id: 21,
          type: 'TRANSFER',
          transferGroupId: groupId,
          transferDirection: 'IN',
          accountId: 2,
          amountMainCurrency: 250,
        }),
      ];
      dbState.accounts = [
        makeAccount({ id: 1, name: 'Wallet' }),
        makeAccount({ id: 2, name: 'Savings' }),
      ];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      const rows = aoaArg.slice(1) as unknown[][];
      // Find OUT row: has debit amount (index 3), income column (index 2) empty
      const outRow = rows.find(r => typeof r[3] === 'number' && r[3] > 0 && (!r[2] || r[2] === ''));
      // Find IN row: has credit amount (index 2), expense column (index 3) empty
      const inRow = rows.find(r => typeof r[2] === 'number' && r[2] > 0 && (!r[3] || r[3] === ''));
      expect(outRow).toBeDefined();
      expect(inRow).toBeDefined();
      // OUT leg: income empty, expense has amount
      expect(outRow![2]).toBe('');
      expect(outRow![3]).toBe(250);
      // IN leg: income has amount, expense empty
      expect(inRow![2]).toBe(250);
      expect(inRow![3]).toBe('');
    });
  });

  describe('date range filtering', () => {
    it('queries Dexie with the provided start and end date strings (inclusive)', async () => {
      setupDomMocks();
      await exportService.exportTransactions('2026-03-01', '2026-03-31', 'EUR');

      expect(mockWhere).toHaveBeenCalledWith('date');
      expect(mockBetween).toHaveBeenCalledWith('2026-03-01', '2026-03-31', true, true);
    });
  });

  describe('browser download trigger', () => {
    it('creates an anchor element and calls click() to initiate download', async () => {
      const { clickMock } = setupDomMocks();
      dbState.transactions = [makeTx({ id: 1 })];
      dbState.accounts = [makeAccount({ id: 1 })];
      dbState.categories = [makeCategory({ id: 1 })];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clickMock).toHaveBeenCalledTimes(1);
    });

    it('sets the correct download filename', async () => {
      const clickMock = vi.fn();
      const anchor = { href: '', download: '', click: clickMock } as unknown as HTMLAnchorElement;
      vi.spyOn(document, 'createElement').mockReturnValue(anchor);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      dbState.transactions = [makeTx({ id: 1 })];
      dbState.accounts = [makeAccount({ id: 1 })];
      dbState.categories = [makeCategory({ id: 1 })];

      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD');

      expect(anchor.download).toBe('expenses_2026-04-01_to_2026-04-30.xlsx');
    });
  });

  describe('error handling', () => {
    it('re-throws errors so callers can handle them', async () => {
      mockWhere.mockImplementationOnce(() => {
        throw new Error('DB connection lost');
      });

      await expect(
        exportService.exportTransactions('2026-04-01', '2026-04-30', 'USD'),
      ).rejects.toThrow('DB connection lost');
    });
  });

  describe('header row', () => {
    it('includes the main currency in income and expense column headers', async () => {
      setupDomMocks();
      await exportService.exportTransactions('2026-04-01', '2026-04-30', 'JPY');

      const aoaArg = vi.mocked(xlsxModule.utils.aoa_to_sheet).mock.calls[0][0] as unknown[][];
      const header = aoaArg[0] as string[];
      expect(header).toContain('Income (JPY)');
      expect(header).toContain('Expense (JPY)');
    });
  });
});
