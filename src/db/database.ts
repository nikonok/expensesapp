import Dexie, { type EntityTable } from 'dexie';
import type {
  Account,
  Category,
  Transaction,
  Budget,
  ExchangeRateCache,
  Setting,
  Backup,
} from './models';

const db = new Dexie('expenses-app-db') as Dexie & {
  accounts: EntityTable<Account, 'id'>;
  categories: EntityTable<Category, 'id'>;
  transactions: EntityTable<Transaction, 'id'>;
  budgets: EntityTable<Budget, 'id'>;
  exchangeRates: EntityTable<ExchangeRateCache, 'id'>;
  settings: EntityTable<Setting, 'key'>;
  backups: EntityTable<Backup, 'id'>;
};

db.version(1).stores({
  accounts:     '++id, type, name, isTrashed, currency',
  categories:   '++id, type, name, isTrashed, displayOrder',
  transactions: '++id, date, accountId, categoryId, type, [date+displayOrder], [accountId+date], transferGroupId',
  budgets:      '++id, categoryId, accountId, month, [categoryId+month], [accountId+month]',
  exchangeRates:'++id, baseCurrency, &[baseCurrency+date]',
  settings:     'key',
  backups:      '++id, createdAt',
});

export { db };
