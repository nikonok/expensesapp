import { useLiveQuery } from 'dexie-react-hooks';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { LayoutGrid } from 'lucide-react';
import { db } from '../db/database';
import { useUIStore } from '../stores/ui-store';
import { useCategories } from '../hooks/use-categories';
import { useAccounts } from '../hooks/use-accounts';
import { useBudgets } from '../hooks/use-budgets';
import PeriodFilter from '../components/shared/PeriodFilter';
import { BudgetSection } from '../components/budget/BudgetSection';
import { EmptyState } from '../components/shared/EmptyState';
import type { BudgetCardData } from '../components/budget/BudgetCard';
import type { PeriodFilter as PeriodFilterType } from '../types';

function monthToPeriodFilter(month: string): PeriodFilterType {
  return {
    type: 'month',
    startDate: `${month}-01`,
    endDate: format(endOfMonth(parseISO(`${month}-01`)), 'yyyy-MM-dd'),
  };
}

function periodFilterToMonth(f: PeriodFilterType): string {
  return format(startOfMonth(parseISO(f.startDate)), 'yyyy-MM');
}

export default function BudgetPage() {
  const budgetMonth = useUIStore((s) => s.budgetMonth);
  const setBudgetMonth = useUIStore((s) => s.setBudgetMonth);

  // Derive date range strings for this month
  const monthStart = `${budgetMonth}-01`;
  const monthEnd = format(endOfMonth(parseISO(monthStart)), 'yyyy-MM-dd');

  // Data
  const expenseCategories = useCategories('EXPENSE');
  const incomeCategories = useCategories('INCOME');
  const allAccounts = useAccounts();
  const budgets = useBudgets(budgetMonth);

  const savingsAccounts = allAccounts.filter((a) => a.type === 'SAVINGS');
  const debtAccounts = allAccounts.filter((a) => a.type === 'DEBT');

  // Sum transactions by categoryId for this month (EXPENSE type)
  const categorySpend = useLiveQuery(async () => {
    const txs = await db.transactions
      .where('date')
      .between(monthStart, monthEnd, true, true)
      .filter((tx) => tx.type === 'EXPENSE' && tx.categoryId != null)
      .toArray();

    const map: Record<number, number> = {};
    for (const tx of txs) {
      if (tx.categoryId != null) {
        map[tx.categoryId] = (map[tx.categoryId] ?? 0) + tx.amountMainCurrency;
      }
    }
    return map;
  }, [monthStart, monthEnd]);

  // Sum INCOME transactions by categoryId for this month
  const categoryIncome = useLiveQuery(async () => {
    const txs = await db.transactions
      .where('date')
      .between(monthStart, monthEnd, true, true)
      .filter((tx) => tx.type === 'INCOME' && tx.categoryId != null)
      .toArray();

    const map: Record<number, number> = {};
    for (const tx of txs) {
      if (tx.categoryId != null) {
        map[tx.categoryId] = (map[tx.categoryId] ?? 0) + tx.amountMainCurrency;
      }
    }
    return map;
  }, [monthStart, monthEnd]);

  // Sum TRANSFER IN to savings/debt accounts for this month
  const accountSpend = useLiveQuery(async () => {
    const txs = await db.transactions
      .where('date')
      .between(monthStart, monthEnd, true, true)
      .filter((tx) => tx.type === 'TRANSFER' && tx.transferDirection === 'IN')
      .toArray();

    const map: Record<number, number> = {};
    for (const tx of txs) {
      map[tx.accountId] = (map[tx.accountId] ?? 0) + tx.amountMainCurrency;
    }
    return map;
  }, [monthStart, monthEnd]);

  // Build budget lookup maps
  const budgetByCategory: Record<number, number> = {};
  const budgetByAccount: Record<number, number> = {};
  for (const b of budgets) {
    if (b.categoryId != null) budgetByCategory[b.categoryId] = b.plannedAmount;
    if (b.accountId != null) budgetByAccount[b.accountId] = b.plannedAmount;
  }

  // Build BudgetCardData arrays
  const expenseItems: BudgetCardData[] = expenseCategories.map((cat) => ({
    id: cat.id!,
    name: cat.name,
    icon: cat.icon,
    color: cat.color,
    planned: budgetByCategory[cat.id!] ?? null,
    spent: categorySpend?.[cat.id!] ?? 0,
  }));

  const incomeItems: BudgetCardData[] = incomeCategories.map((cat) => ({
    id: cat.id!,
    name: cat.name,
    icon: cat.icon,
    color: cat.color,
    planned: budgetByCategory[cat.id!] ?? null,
    spent: categoryIncome?.[cat.id!] ?? 0,
  }));

  const savingsItems: BudgetCardData[] = savingsAccounts.map((acc) => ({
    id: acc.id!,
    name: acc.name,
    icon: acc.icon,
    color: acc.color,
    planned: budgetByAccount[acc.id!] ?? null,
    spent: accountSpend?.[acc.id!] ?? 0,
  }));

  const debtItems: BudgetCardData[] = debtAccounts.map((acc) => ({
    id: acc.id!,
    name: acc.name,
    icon: acc.icon,
    color: acc.color,
    planned: budgetByAccount[acc.id!] ?? null,
    spent: accountSpend?.[acc.id!] ?? 0,
  }));

  // Loading state
  const isLoading = categorySpend === undefined || categoryIncome === undefined || accountSpend === undefined;

  // Empty state check
  const hasBudgets = budgets.length > 0;
  const hasTxData =
    Object.keys(categorySpend ?? {}).length > 0 ||
    Object.keys(categoryIncome ?? {}).length > 0 ||
    Object.keys(accountSpend ?? {}).length > 0;
  const hasItems =
    expenseCategories.length > 0 ||
    incomeCategories.length > 0 ||
    savingsAccounts.length > 0 ||
    debtAccounts.length > 0;
  const isEmpty = !isLoading && !hasBudgets && !hasTxData && !hasItems;

  // PeriodFilter bridge
  const periodFilter = monthToPeriodFilter(budgetMonth);
  const handlePeriodChange = (f: PeriodFilterType) => {
    setBudgetMonth(periodFilterToMonth(f));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Period filter bar */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--color-border)',
          gap: 'var(--space-3)',
          flexShrink: 0,
        }}
      >
        <PeriodFilter
          value={periodFilter}
          onChange={handlePeriodChange}
          variant="month-only"
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingTop: 'var(--space-4)' }}>
        {isEmpty ? (
          <EmptyState
            icon={LayoutGrid}
            heading="No budget data"
            body="No budgets planned and no transactions for this month."
          />
        ) : (
          <>
            <BudgetSection
              title="Expenses"
              items={expenseItems}
              month={budgetMonth}
              type="category"
              isLoading={isLoading}
            />
            <BudgetSection
              title="Income"
              items={incomeItems}
              month={budgetMonth}
              type="category"
              isLoading={isLoading}
            />
            <BudgetSection
              title="Savings"
              items={savingsItems}
              month={budgetMonth}
              type="account"
              isLoading={isLoading}
            />
            <BudgetSection
              title="Debt"
              items={debtItems}
              month={budgetMonth}
              type="account"
              isLoading={isLoading}
            />
          </>
        )}
      </div>
    </div>
  );
}
