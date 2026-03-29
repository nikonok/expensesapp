import { useLiveQuery } from 'dexie-react-hooks';
import { subMonths, format, differenceInCalendarMonths, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { db } from '../../db/database';
import type { Transaction } from '../../db/models';
import { useSettingsStore } from '../../stores/settings-store';

interface BudgetStatsProps {
  categoryId?: number;
  accountId?: number;
  month: string; // "YYYY-MM"
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function BudgetStats({ categoryId, accountId, month }: BudgetStatsProps) {
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  // Derive start/end of current month
  const monthDate = parseISO(`${month}-01`);
  const prevMonth = subMonths(monthDate, 1);
  const prevMonthStr = format(prevMonth, 'yyyy-MM');
  const prevStart = format(startOfMonth(prevMonth), 'yyyy-MM-dd');
  const prevEnd = format(endOfMonth(prevMonth), 'yyyy-MM-dd');

  const stats = useLiveQuery(async () => {
    // 1. All transactions matching categoryId or accountId
    let allTxs: Transaction[];
    if (categoryId != null) {
      allTxs = await db.transactions
        .where('categoryId')
        .equals(categoryId)
        .toArray();
    } else if (accountId != null) {
      // For savings/debt accounts: TRANSFER IN transactions
      allTxs = await db.transactions
        .where('accountId')
        .equals(accountId)
        .filter((tx) => tx.type === 'TRANSFER' && tx.transferDirection === 'IN')
        .toArray();
    } else {
      allTxs = [];
    }

    if (allTxs.length === 0) {
      return { avgMonthly: null, lastMonth: null, lastBudget: null };
    }

    // Average monthly spend
    const dates = allTxs.map((tx) => tx.date).sort();
    const firstDate = parseISO(dates[0]);
    const lastDate = parseISO(dates[dates.length - 1]);
    const numMonths = Math.max(1, differenceInCalendarMonths(lastDate, firstDate) + 1);
    const totalSum = allTxs.reduce((sum, tx) => sum + tx.amountMainCurrency, 0);
    const avgMonthly = totalSum / numMonths;

    // Last month actual
    const lastMonthTxs = allTxs.filter(
      (tx) => tx.date >= prevStart && tx.date <= prevEnd,
    );
    const lastMonth = lastMonthTxs.length > 0
      ? lastMonthTxs.reduce((sum, tx) => sum + tx.amountMainCurrency, 0)
      : null;

    // Last set budget
    let lastBudget: number | null = null;
    if (categoryId != null) {
      const budgets = await db.budgets
        .where('categoryId')
        .equals(categoryId)
        .toArray();
      // Sort by month desc
      budgets.sort((a, b) => b.month.localeCompare(a.month));
      if (budgets.length > 0) lastBudget = budgets[0].plannedAmount;
    } else if (accountId != null) {
      const budgets = await db.budgets
        .where('accountId')
        .equals(accountId)
        .toArray();
      budgets.sort((a, b) => b.month.localeCompare(a.month));
      if (budgets.length > 0) lastBudget = budgets[0].plannedAmount;
    }

    return { avgMonthly, lastMonth, lastBudget };
  }, [categoryId, accountId, prevMonthStr]);

  const rows: { label: string; value: string }[] = [
    {
      label: 'Avg monthly',
      value:
        stats?.avgMonthly != null
          ? formatAmount(stats.avgMonthly, mainCurrency)
          : 'N/A',
    },
    {
      label: `Last month (${format(prevMonth, 'MM.yyyy')})`,
      value:
        stats?.lastMonth != null
          ? formatAmount(stats.lastMonth, mainCurrency)
          : 'N/A',
    },
    {
      label: 'Last set budget',
      value:
        stats?.lastBudget != null
          ? formatAmount(stats.lastBudget, mainCurrency)
          : 'N/A',
    },
  ];

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            minHeight: '48px',
            borderBottom: '1px solid var(--color-border)',
            padding: '0 var(--space-1)',
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {row.label}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: 'var(--text-amount-sm)',
              color: row.value === 'N/A' ? 'var(--color-text-disabled)' : 'var(--color-text)',
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
