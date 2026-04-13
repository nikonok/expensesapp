import { db } from '../db/database';
import type { Backup } from '../db/models';
import { accountSchema, categorySchema, transactionSchema, budgetSchema } from '../utils/validation';

interface BackupJSON {
  version: number;
  exportedAt: string;
  appVersion: string;
  tables: {
    accounts: unknown[];
    categories: unknown[];
    transactions: unknown[];
    budgets: unknown[];
    exchangeRates: unknown[];
    settings: unknown[];
  };
}

class BackupService {
  private _autoBackupIntervalId: ReturnType<typeof setInterval> | null = null;

  private validateBackupStructure(parsed: unknown): parsed is BackupJSON {
    if (typeof parsed !== 'object' || parsed === null) return false;
    const p = parsed as Record<string, unknown>;
    if (!('version' in p) || !('tables' in p)) return false;
    const tables = p.tables as Record<string, unknown>;
    if (typeof tables !== 'object' || tables === null) return false;
    const required = ['accounts', 'categories', 'transactions', 'budgets', 'exchangeRates', 'settings'];
    return required.every(k => Array.isArray(tables[k]));
  }

  private async _buildSnapshot(): Promise<BackupJSON> {
    const [accounts, categories, transactions, budgets, exchangeRates, settings] =
      await Promise.all([
        db.accounts.toArray(),
        db.categories.toArray(),
        db.transactions.toArray(),
        db.budgets.toArray(),
        db.exchangeRates.toArray(),
        db.settings.toArray(),
      ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      tables: { accounts, categories, transactions, budgets, exchangeRates, settings },
    };
  }

  async createBackup(isAutomatic = false): Promise<void> {
    const snapshot = await this._buildSnapshot();

    const record: Omit<Backup, 'id'> = {
      data: JSON.stringify(snapshot),
      createdAt: new Date().toISOString(),
      isAutomatic,
    };

    await db.transaction('rw', db.backups, async () => {
      await db.backups.add(record as Backup);

      // Prune: keep only the most recent backup
      const allBackups = await db.backups.orderBy('createdAt').toArray();
      if (allBackups.length > 1) {
        const idsToDelete = allBackups.slice(0, allBackups.length - 1).map(b => b.id!);
        await db.backups.bulkDelete(idsToDelete);
      }
    });
  }

  async listBackups(): Promise<Backup[]> {
    const all = await db.backups.toArray();
    return all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async restoreFromBackup(backupId: number): Promise<void> {
    const record = await db.backups.get(backupId);
    if (!record) throw new Error(`Backup ${backupId} not found`);
    let parsed: BackupJSON;
    try {
      parsed = JSON.parse(record.data);
    } catch {
      throw new Error('Backup data is corrupted and cannot be parsed');
    }
    if (!this.validateBackupStructure(parsed)) {
      throw new Error('Backup data has invalid structure');
    }
    await this._restoreData(parsed);
  }

  async exportToFile(): Promise<void> {
    const snapshot = await this._buildSnapshot();
    const jsonStr = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async importFromFile(file: File): Promise<void> {
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_SIZE) {
      throw new Error('Backup file is too large (max 10 MB)');
    }
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid backup file: not valid JSON');
    }

    if (!this.validateBackupStructure(parsed)) {
      throw new Error('Invalid backup file structure');
    }

    await this._restoreData(parsed);
  }

  setAutoBackupSchedule(intervalHours: number | null): void {
    if (this._autoBackupIntervalId !== null) {
      clearInterval(this._autoBackupIntervalId);
      this._autoBackupIntervalId = null;
    }

    if (intervalHours !== null) {
      this._autoBackupIntervalId = setInterval(
        () =>
          void (async () => {
            await this.createBackup(true);
            await db.settings.put({ key: 'lastAutoBackupAt', value: new Date().toISOString() });
          })(),
        intervalHours * 3_600_000,
      );
    }
  }

  async checkAndRunAutoBackup(): Promise<void> {
    const [intervalSetting, lastAtSetting] = await Promise.all([
      db.settings.get('autoBackupIntervalHours'),
      db.settings.get('lastAutoBackupAt'),
    ]);

    const intervalHours =
      intervalSetting != null &&
      typeof intervalSetting.value === 'number'
        ? intervalSetting.value
        : null;

    if (intervalHours === null) return;

    const lastAt =
      lastAtSetting != null && typeof lastAtSetting.value === 'string'
        ? lastAtSetting.value
        : null;

    const now = Date.now();
    const threshold = intervalHours * 3_600_000;
    const lastMs = lastAt ? new Date(lastAt).getTime() : 0;

    if (now - lastMs > threshold) {
      await this.createBackup(true);
      await db.settings.put({ key: 'lastAutoBackupAt', value: new Date().toISOString() });
    }
  }

  async _restoreData(data: BackupJSON): Promise<void> {
    const validAccounts = (data.tables.accounts as unknown[]).filter(
      row => accountSchema.safeParse(row).success,
    );
    if (data.tables.accounts.length > 0 && validAccounts.length === 0) {
      throw new Error('Invalid backup file: accounts table failed validation');
    }

    const validCategories = (data.tables.categories as unknown[]).filter(
      row => categorySchema.safeParse(row).success,
    );
    if (data.tables.categories.length > 0 && validCategories.length === 0) {
      throw new Error('Invalid backup file: categories table failed validation');
    }

    const validTransactions = (data.tables.transactions as unknown[]).filter(
      row => transactionSchema.safeParse(row).success,
    );
    if (data.tables.transactions.length > 0 && validTransactions.length === 0) {
      throw new Error('Invalid backup file: transactions table failed validation');
    }

    const validBudgets = (data.tables.budgets as unknown[]).filter(
      row => budgetSchema.safeParse(row).success,
    );
    if (data.tables.budgets.length > 0 && validBudgets.length === 0) {
      throw new Error('Invalid backup file: budgets table failed validation');
    }

    const validExchangeRates = (data.tables.exchangeRates as unknown[]).filter(row => {
      if (typeof row !== 'object' || row === null) return false;
      const r = row as Record<string, unknown>;
      return r.baseCurrency != null && r.rates != null;
    });
    if (data.tables.exchangeRates.length > 0 && validExchangeRates.length === 0) {
      throw new Error('Invalid backup file: exchangeRates table failed validation');
    }

    const validSettings = (data.tables.settings as unknown[]).filter(row => {
      if (typeof row !== 'object' || row === null) return false;
      const r = row as Record<string, unknown>;
      return r.key != null && r.value != null;
    });
    if (data.tables.settings.length > 0 && validSettings.length === 0) {
      throw new Error('Invalid backup file: settings table failed validation');
    }

    await db.transaction(
      'rw',
      [
        db.accounts,
        db.categories,
        db.transactions,
        db.budgets,
        db.exchangeRates,
        db.settings,
      ],
      async () => {
        await db.accounts.clear();
        await db.categories.clear();
        await db.transactions.clear();
        await db.budgets.clear();
        await db.exchangeRates.clear();
        await db.settings.clear();

        if (validAccounts.length)
          await db.accounts.bulkAdd(validAccounts as Parameters<typeof db.accounts.bulkAdd>[0]);
        if (validCategories.length)
          await db.categories.bulkAdd(validCategories as Parameters<typeof db.categories.bulkAdd>[0]);
        if (validTransactions.length)
          await db.transactions.bulkAdd(validTransactions as Parameters<typeof db.transactions.bulkAdd>[0]);
        if (validBudgets.length)
          await db.budgets.bulkAdd(validBudgets as Parameters<typeof db.budgets.bulkAdd>[0]);
        if (validExchangeRates.length)
          await db.exchangeRates.bulkAdd(validExchangeRates as Parameters<typeof db.exchangeRates.bulkAdd>[0]);
        if (validSettings.length)
          await db.settings.bulkAdd(validSettings as Parameters<typeof db.settings.bulkAdd>[0]);
      },
    );

    window.dispatchEvent(new CustomEvent('backup-restored'));
  }
}

export const backupService = new BackupService();

export const createBackup = backupService.createBackup.bind(backupService);
export const listBackups = backupService.listBackups.bind(backupService);
export const restoreFromBackup = backupService.restoreFromBackup.bind(backupService);
export const exportToFile = backupService.exportToFile.bind(backupService);
export const importFromFile = backupService.importFromFile.bind(backupService);
export const setAutoBackupSchedule = backupService.setAutoBackupSchedule.bind(backupService);
export const checkAndRunAutoBackup = backupService.checkAndRunAutoBackup.bind(backupService);
