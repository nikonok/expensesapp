import { db } from '../db/database';
import type { Backup } from '../db/models';

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

  async createBackup(isAutomatic = false): Promise<void> {
    const [accounts, categories, transactions, budgets, exchangeRates, settings] =
      await Promise.all([
        db.accounts.toArray(),
        db.categories.toArray(),
        db.transactions.toArray(),
        db.budgets.toArray(),
        db.exchangeRates.toArray(),
        db.settings.toArray(),
      ]);

    const snapshot: BackupJSON = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      tables: {
        accounts,
        categories,
        transactions,
        budgets,
        exchangeRates,
        settings,
      },
    };

    const record: Omit<Backup, 'id'> = {
      data: JSON.stringify(snapshot),
      createdAt: new Date().toISOString(),
      isAutomatic,
    };

    await db.backups.add(record as Backup);
  }

  async listBackups(): Promise<Backup[]> {
    const all = await db.backups.toArray();
    return all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async restoreFromBackup(backupId: number): Promise<void> {
    const record = await db.backups.get(backupId);
    if (!record) throw new Error(`Backup ${backupId} not found`);
    const parsed: BackupJSON = JSON.parse(record.data);
    await this._restoreData(parsed);
  }

  async exportToFile(): Promise<void> {
    const [accounts, categories, transactions, budgets, exchangeRates, settings] =
      await Promise.all([
        db.accounts.toArray(),
        db.categories.toArray(),
        db.transactions.toArray(),
        db.budgets.toArray(),
        db.exchangeRates.toArray(),
        db.settings.toArray(),
      ]);

    const snapshot: BackupJSON = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      tables: {
        accounts,
        categories,
        transactions,
        budgets,
        exchangeRates,
        settings,
      },
    };

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
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed)
    ) {
      throw new Error('Invalid backup file: missing version field');
    }

    await this._restoreData(parsed as BackupJSON);
  }

  setAutoBackupSchedule(intervalHours: number | null): void {
    if (this._autoBackupIntervalId !== null) {
      clearInterval(this._autoBackupIntervalId);
      this._autoBackupIntervalId = null;
    }

    if (intervalHours !== null) {
      this._autoBackupIntervalId = setInterval(
        () => void this.createBackup(true),
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

        if (data.tables.accounts?.length)
          await db.accounts.bulkAdd(data.tables.accounts as Parameters<typeof db.accounts.bulkAdd>[0]);
        if (data.tables.categories?.length)
          await db.categories.bulkAdd(data.tables.categories as Parameters<typeof db.categories.bulkAdd>[0]);
        if (data.tables.transactions?.length)
          await db.transactions.bulkAdd(data.tables.transactions as Parameters<typeof db.transactions.bulkAdd>[0]);
        if (data.tables.budgets?.length)
          await db.budgets.bulkAdd(data.tables.budgets as Parameters<typeof db.budgets.bulkAdd>[0]);
        if (data.tables.exchangeRates?.length)
          await db.exchangeRates.bulkAdd(data.tables.exchangeRates as Parameters<typeof db.exchangeRates.bulkAdd>[0]);
        if (data.tables.settings?.length)
          await db.settings.bulkAdd(data.tables.settings as Parameters<typeof db.settings.bulkAdd>[0]);
      },
    );

    window.location.reload();
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
