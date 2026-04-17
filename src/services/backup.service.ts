import { db } from '../db/database';
import type { Backup } from '../db/models';
import {
  backupAccountSchema,
  backupCategorySchema,
  backupTransactionSchema,
  backupBudgetSchema,
  backupExchangeRateSchema,
  backupSettingSchema,
} from '../utils/backup-validation';
import { logger } from './log.service';

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
    logger.info('backup.created', { isAutomatic });
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
    try {
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
      logger.info('backup.exported');
    } catch (err) {
      logger.error('backup.export.failed', err instanceof Error ? err : { message: String(err) });
      throw err;
    }
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

    try {
      await this._restoreData(parsed);
      logger.info('backup.restored');
    } catch (err) {
      logger.error('backup.restore.failed', err instanceof Error ? err : { message: String(err) });
      throw err;
    }
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
          })().catch(err => console.error('[AutoBackup] periodic check failed:', err)),
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

  private async _restoreData(data: BackupJSON): Promise<void> {
    function validateTable<T>(
      rows: unknown[],
      schema: { safeParse: (r: unknown) => { success: boolean; data?: T; error?: { issues: { code: string; path: PropertyKey[]; message: string }[] } } },
      tableName: string,
    ): T[] {
      return rows.map((row, i) => {
        const result = schema.safeParse(row);
        if (!result.success) {
          const detail = JSON.stringify(
            result.error!.issues.map(({ code, path, message }) => ({ code, path, message }))
          ).slice(0, 200);
          throw new Error(
            `Invalid backup: ${tableName}[${i}] failed validation. ${detail}`,
          );
        }
        return result.data as T;
      });
    }

    const validAccounts = validateTable(data.tables.accounts, backupAccountSchema, 'accounts');
    const validCategories = validateTable(data.tables.categories, backupCategorySchema, 'categories');
    const validTransactions = validateTable(data.tables.transactions, backupTransactionSchema, 'transactions');
    const validBudgets = validateTable(data.tables.budgets, backupBudgetSchema, 'budgets');
    const validExchangeRates = validateTable(data.tables.exchangeRates, backupExchangeRateSchema, 'exchangeRates');
    const validSettings = validateTable(data.tables.settings, backupSettingSchema, 'settings');

    await db.transaction(
      'rw',
      [db.accounts, db.categories, db.transactions, db.budgets, db.exchangeRates, db.settings],
      async () => {
        await db.accounts.clear();
        await db.categories.clear();
        await db.transactions.clear();
        await db.budgets.clear();
        await db.exchangeRates.clear();
        await db.settings.clear();

        if (validAccounts.length) await db.accounts.bulkAdd(validAccounts as any);
        if (validCategories.length) await db.categories.bulkAdd(validCategories as any);
        if (validTransactions.length) await db.transactions.bulkAdd(validTransactions as any);
        if (validBudgets.length) await db.budgets.bulkAdd(validBudgets as any);
        if (validExchangeRates.length) await db.exchangeRates.bulkAdd(validExchangeRates as any);
        // settings pk is `key` (string, not autoincrement) → bulkPut tolerates duplicates
        if (validSettings.length) await db.settings.bulkPut(validSettings as any);
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
