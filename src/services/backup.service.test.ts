import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import type { Account, Category, Transaction, Budget } from '@/db/models';
import {
  backupService,
  checkAndRunAutoBackup,
  createBackup,
  importFromFile,
  listBackups,
  restoreFromBackup,
  setAutoBackupSchedule,
} from './backup.service';

// The service calls window.dispatchEvent; provide a minimal stub in Node environment.
if (typeof window === 'undefined') {
  const globalAny = globalThis as Record<string, unknown>;
  globalAny['window'] = globalThis;
  if (typeof (globalThis as Record<string, unknown>)['dispatchEvent'] === 'undefined') {
    (globalThis as Record<string, unknown>)['dispatchEvent'] = () => true;
  }
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: 'Test Account',
    type: 'REGULAR',
    color: 'oklch(70% 0.2 180)',
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

function makeValidBackupJSON(overrides: Record<string, unknown> = {}): object {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    tables: {
      accounts: [],
      categories: [],
      transactions: [],
      budgets: [],
      exchangeRates: [],
      settings: [],
    },
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    name: 'Test Category',
    type: 'EXPENSE',
    color: 'oklch(70% 0.2 180)',
    icon: 'tag',
    displayOrder: 0,
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: 'EXPENSE',
    date: '2026-01-01',
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId: 1,
    categoryId: 1,
    currency: 'USD',
    amount: 500,
    amountMainCurrency: 500,
    exchangeRate: 1,
    note: '',
    isTrashed: false,
    transferGroupId: null,
    transferDirection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    categoryId: 1,
    accountId: null,
    month: '2026-01',
    plannedAmount: 10000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFile(content: string, sizeOverride?: number): File {
  const file = new File([content], 'backup.json', { type: 'application/json' });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
}

beforeEach(async () => {
  await db.accounts.clear();
  await db.categories.clear();
  await db.transactions.clear();
  await db.budgets.clear();
  await db.exchangeRates.clear();
  await db.settings.clear();
  await db.backups.clear();
});

describe('createBackup', () => {
  it('stores a backup in db.backups with isAutomatic: false by default', async () => {
    await createBackup();
    const all = await db.backups.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].isAutomatic).toBe(false);
  });

  it('stores isAutomatic: true when called with true', async () => {
    await createBackup(true);
    const all = await db.backups.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].isAutomatic).toBe(true);
  });

  it('after two calls, exactly 1 backup remains (pruning works)', async () => {
    await createBackup();
    await createBackup();
    const all = await db.backups.toArray();
    expect(all).toHaveLength(1);
  });

  it('the remaining backup after pruning is the most recent one', async () => {
    await createBackup();
    // small delay to ensure distinct createdAt values
    await new Promise(resolve => setTimeout(resolve, 5));
    await createBackup(true);
    const all = await db.backups.toArray();
    expect(all).toHaveLength(1);
    // the second backup was automatic
    expect(all[0].isAutomatic).toBe(true);
  });

  it('the backup JSON contains the correct tables structure', async () => {
    await db.accounts.add(makeAccount({ name: 'My Account' }));
    await createBackup();
    const all = await db.backups.toArray();
    const parsed = JSON.parse(all[0].data) as {
      version: number;
      tables: Record<string, unknown[]>;
    };
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.tables.accounts)).toBe(true);
    expect(Array.isArray(parsed.tables.categories)).toBe(true);
    expect(Array.isArray(parsed.tables.transactions)).toBe(true);
    expect(Array.isArray(parsed.tables.budgets)).toBe(true);
    expect(Array.isArray(parsed.tables.exchangeRates)).toBe(true);
    expect(Array.isArray(parsed.tables.settings)).toBe(true);
    expect(parsed.tables.accounts).toHaveLength(1);
    expect((parsed.tables.accounts[0] as Account).name).toBe('My Account');
  });
});

describe('listBackups', () => {
  it('returns empty array when no backups exist', async () => {
    const result = await listBackups();
    expect(result).toEqual([]);
  });

  it('returns backups sorted newest-first (most recent at index 0)', async () => {
    await createBackup();
    await new Promise(resolve => setTimeout(resolve, 5));
    await createBackup(true);
    // After two calls, only 1 remains due to pruning — re-insert two manually
    await db.backups.clear();
    const older = '2026-01-01T00:00:00.000Z';
    const newer = '2026-06-01T00:00:00.000Z';
    await db.backups.add({ createdAt: older, data: '{}', isAutomatic: false });
    await db.backups.add({ createdAt: newer, data: '{}', isAutomatic: false });

    const result = await listBackups();
    expect(result).toHaveLength(2);
    expect(result[0].createdAt).toBe(newer);
    expect(result[1].createdAt).toBe(older);
  });
});

describe('restoreFromBackup', () => {
  it('restores account data: after backing up, clearing, then restoring, the account is back', async () => {
    await db.accounts.add(makeAccount({ name: 'Savings Account' }));
    await createBackup();
    const [backup] = await db.backups.toArray();

    await db.accounts.clear();
    expect(await db.accounts.count()).toBe(0);

    await restoreFromBackup(backup.id!);
    const restored = await db.accounts.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe('Savings Account');
  });

  it('clears existing data before restore: accounts not in the backup are gone after restore', async () => {
    // Set up original state and back it up (1 account)
    await db.accounts.add(makeAccount({ name: 'Original' }));
    await createBackup();
    const [backup] = await db.backups.toArray();

    // Add a second account that was NOT in the backup
    await db.accounts.add(makeAccount({ name: 'New Account' }));
    expect(await db.accounts.count()).toBe(2);

    await restoreFromBackup(backup.id!);
    const restored = await db.accounts.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe('Original');
  });

  it('dispatches backup-restored custom event on window', async () => {
    await createBackup();
    const [backup] = await db.backups.toArray();
    const spy = vi.spyOn(window, 'dispatchEvent');

    await restoreFromBackup(backup.id!);

    expect(spy).toHaveBeenCalledOnce();
    const event = spy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('backup-restored');
    spy.mockRestore();
  });

  it('throws if backupId does not exist', async () => {
    await expect(restoreFromBackup(99999)).rejects.toThrow('99999');
  });

  it('throws if backup data is corrupted JSON', async () => {
    const id = await db.backups.add({
      createdAt: new Date().toISOString(),
      data: 'not-valid-json{{{',
      isAutomatic: false,
    });
    await expect(restoreFromBackup(id as number)).rejects.toThrow(/corrupted/i);
  });
});

describe('checkAndRunAutoBackup', () => {
  it('does nothing if autoBackupIntervalHours setting is not set', async () => {
    await checkAndRunAutoBackup();
    expect(await db.backups.count()).toBe(0);
  });

  it('does nothing if last backup was recent (within the interval)', async () => {
    const intervalHours = 24;
    // lastAutoBackupAt = 1 hour ago; interval = 24h → not overdue
    const recentAt = new Date(Date.now() - 1 * 3_600_000).toISOString();
    await db.settings.put({ key: 'autoBackupIntervalHours', value: intervalHours });
    await db.settings.put({ key: 'lastAutoBackupAt', value: recentAt });

    await checkAndRunAutoBackup();
    expect(await db.backups.count()).toBe(0);
  });

  it('creates a backup and updates lastAutoBackupAt if last backup is overdue', async () => {
    const intervalHours = 24;
    // lastAutoBackupAt = 25 hours ago → overdue
    const overdueAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await db.settings.put({ key: 'autoBackupIntervalHours', value: intervalHours });
    await db.settings.put({ key: 'lastAutoBackupAt', value: overdueAt });

    await checkAndRunAutoBackup();

    expect(await db.backups.count()).toBe(1);
    const setting = await db.settings.get('lastAutoBackupAt');
    expect(setting).toBeDefined();
    expect(typeof setting!.value).toBe('string');
    // lastAutoBackupAt should now be more recent than the overdue timestamp
    expect(new Date(setting!.value as string).getTime()).toBeGreaterThan(
      new Date(overdueAt).getTime(),
    );
  });

  it('creates a backup if lastAutoBackupAt has never been set (treats as epoch)', async () => {
    await db.settings.put({ key: 'autoBackupIntervalHours', value: 24 });
    // No lastAutoBackupAt set at all

    await checkAndRunAutoBackup();
    expect(await db.backups.count()).toBe(1);
  });
});

describe('setAutoBackupSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clear any lingering interval before restoring real timers
    setAutoBackupSchedule(null);
    vi.useRealTimers();
  });

  it('calling with a number starts an interval that fires createBackup after the interval elapses', async () => {
    const spy = vi.spyOn(backupService, 'createBackup').mockResolvedValue(undefined);

    setAutoBackupSchedule(1); // 1 hour
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1 * 3_600_000);
    expect(spy).toHaveBeenCalledOnce();

    spy.mockRestore();
  });

  it('calling with null clears any existing interval (no more firings after)', async () => {
    const spy = vi.spyOn(backupService, 'createBackup').mockResolvedValue(undefined);

    setAutoBackupSchedule(1); // 1 hour
    setAutoBackupSchedule(null);

    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('calling with a new value replaces the old interval (no double-firing)', async () => {
    const spy = vi.spyOn(backupService, 'createBackup').mockResolvedValue(undefined);

    setAutoBackupSchedule(1); // 1 hour interval
    setAutoBackupSchedule(2); // replace with 2 hour interval

    // Advance 1 hour — old interval would have fired; new one should not yet
    await vi.advanceTimersByTimeAsync(1 * 3_600_000);
    expect(spy).not.toHaveBeenCalled();

    // Advance another hour (total 2h) — new interval fires exactly once
    await vi.advanceTimersByTimeAsync(1 * 3_600_000);
    expect(spy).toHaveBeenCalledOnce();

    spy.mockRestore();
  });
});

describe('importFromFile', () => {
  it('throws if file is too large (> 10 MB)', async () => {
    const file = makeFile('{}', 11 * 1024 * 1024);
    await expect(importFromFile(file)).rejects.toThrow(/too large/i);
  });

  it('throws if file content is not valid JSON', async () => {
    const file = makeFile('this is not json at all');
    await expect(importFromFile(file)).rejects.toThrow(/not valid JSON/i);
  });

  it('throws if JSON structure is missing required tables', async () => {
    const badStructure = JSON.stringify({ version: 1, tables: { accounts: [] } });
    const file = makeFile(badStructure);
    await expect(importFromFile(file)).rejects.toThrow(/structure/i);
  });

  it('successfully restores data from a valid file', async () => {
    const backupData = makeValidBackupJSON({
      tables: {
        accounts: [makeAccount({ id: 1, name: 'Imported Account' })],
        categories: [],
        transactions: [],
        budgets: [],
        exchangeRates: [],
        settings: [],
      },
    });
    const file = makeFile(JSON.stringify(backupData));
    const spy = vi.spyOn(window, 'dispatchEvent');

    await importFromFile(file);

    const accounts = await db.accounts.toArray();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Imported Account');
    expect(spy).toHaveBeenCalledOnce();
    const event = spy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('backup-restored');
    spy.mockRestore();
  });
});

describe('_restoreData — full shape round-trip', () => {
  it('isTrashed, timestamp, displayOrder, createdAt, updatedAt survive restore', async () => {
    const fixedTs = '2025-06-15T12:00:00.000Z';
    const accountId = await db.accounts.add(
      makeAccount({ isTrashed: true }) as Account,
    );
    const categoryId = await db.categories.add(
      makeCategory({ displayOrder: 5, isTrashed: true }) as Category,
    );
    await db.transactions.add(
      makeTransaction({
        accountId: accountId as number,
        categoryId: categoryId as number,
        isTrashed: true,
        timestamp: fixedTs,
        displayOrder: 7,
      }) as Transaction,
    );

    await createBackup();
    const [backup] = await db.backups.toArray();

    await db.accounts.clear();
    await db.categories.clear();
    await db.transactions.clear();

    await restoreFromBackup(backup.id!);

    const [restoredAccount] = await db.accounts.toArray();
    expect(restoredAccount.isTrashed).toBe(true);

    const [restoredCategory] = await db.categories.toArray();
    expect(restoredCategory.displayOrder).toBe(5);
    expect(restoredCategory.isTrashed).toBe(true);

    const [restoredTx] = await db.transactions.toArray();
    expect(restoredTx.isTrashed).toBe(true);
    expect(restoredTx.timestamp).toBe(fixedTs);
    expect(restoredTx.displayOrder).toBe(7);
  });

  it('transaction with amount: 0 survives restore (regression — old schema rejected zero)', async () => {
    const accountId = await db.accounts.add(makeAccount() as Account);
    await db.transactions.add(
      makeTransaction({
        type: 'TRANSFER',
        accountId: accountId as number,
        categoryId: null,
        amount: 0,
        amountMainCurrency: 0,
        transferGroupId: 'test-group-uuid',
        transferDirection: 'OUT',
      }) as Transaction,
    );

    await createBackup();
    const [backup] = await db.backups.toArray();

    await db.transactions.clear();

    await restoreFromBackup(backup.id!);

    const [restoredTx] = await db.transactions.toArray();
    expect(restoredTx.amount).toBe(0);
    expect(restoredTx.amountMainCurrency).toBe(0);
  });

  it('budget with null categoryId and null accountId survives restore', async () => {
    await db.budgets.add(
      makeBudget({ categoryId: null, accountId: null }) as Budget,
    );

    await createBackup();
    const [backup] = await db.backups.toArray();

    await db.budgets.clear();

    await restoreFromBackup(backup.id!);

    const [restoredBudget] = await db.budgets.toArray();
    expect(restoredBudget.categoryId).toBeNull();
    expect(restoredBudget.accountId).toBeNull();
  });

  it('Dexie error inside transaction propagates as a real error', async () => {
    await db.accounts.add(makeAccount({ name: 'Disk Full Test' }) as Account);

    await createBackup();
    const [backup] = await db.backups.toArray();

    await db.accounts.clear();

    const spy = vi
      .spyOn(db.accounts, 'bulkAdd')
      .mockRejectedValueOnce(new Error('disk full'));

    try {
      await expect(restoreFromBackup(backup.id!)).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }
  });

  it('settings table — duplicate keys tolerated via bulkPut', async () => {
    const backupData = makeValidBackupJSON({
      tables: {
        accounts: [],
        categories: [],
        transactions: [],
        budgets: [],
        exchangeRates: [],
        settings: [
          { key: 'mainCurrency', value: 'USD' },
          { key: 'mainCurrency', value: 'EUR' },
        ],
      },
    });

    const backupId = await db.backups.add({
      createdAt: new Date().toISOString(),
      data: JSON.stringify(backupData),
      isAutomatic: false,
    });

    await expect(restoreFromBackup(backupId as number)).resolves.toBeUndefined();

    const setting = await db.settings.get('mainCurrency');
    expect(setting?.value).toBe('EUR');
  });
});
