import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db } from '../db/database';
import type { Transaction } from '../db/models';
import type { PeriodFilter } from '../types';
import { parsePeriodFilter } from '../utils/date-utils';

interface UseTransactionsOptions {
  filter: PeriodFilter;
  accountId?: number;
  categoryId?: number;
  noteContains?: string;
}

export function useTransactions(opts: UseTransactionsOptions): Transaction[] {
  const { filter, accountId, categoryId, noteContains } = opts;

  return (
    useLiveQuery(async () => {
      const { start, end } = parsePeriodFilter(filter);
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      let results = await db.transactions
        .where('date')
        .between(startStr, endStr, true, true)
        .toArray();

      if (accountId !== undefined) {
        results = results.filter((t) => t.accountId === accountId);
      }

      if (categoryId !== undefined) {
        results = results.filter((t) => t.categoryId === categoryId);
      }

      if (noteContains && noteContains.trim() !== '') {
        const lower = noteContains.toLowerCase();
        results = results.filter((t) => t.note.toLowerCase().includes(lower));
      }

      results.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return a.displayOrder - b.displayOrder;
      });

      return results;
    }, [filter, accountId, categoryId, noteContains]) ?? []
  );
}
