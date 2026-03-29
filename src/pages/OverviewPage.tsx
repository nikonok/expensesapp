import { BarChart2 } from 'lucide-react';
import PeriodFilter from '../components/shared/PeriodFilter';
import { EmptyState } from '../components/shared/EmptyState';
import OverviewSummary from '../components/overview/OverviewSummary';
import SpendingBarChart from '../components/overview/SpendingBarChart';
import DailyAverages from '../components/overview/DailyAverages';
import CategoryBreakdown from '../components/overview/CategoryBreakdown';
import { useUIStore } from '../stores/ui-store';
import { useSettingsStore } from '../stores/settings-store';
import { useTransactions } from '../hooks/use-transactions';
import { parsePeriodFilter } from '../utils/date-utils';

export default function OverviewPage() {
  const overviewFilter = useUIStore((s) => s.overviewFilter);
  const setOverviewFilter = useUIStore((s) => s.setOverviewFilter);
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  const transactions = useTransactions({ filter: overviewFilter });

  const { start, end } = parsePeriodFilter(overviewFilter);

  const expenses = transactions.filter((t) => t.type === 'EXPENSE');
  const incomes = transactions.filter((t) => t.type === 'INCOME');

  const totalExpense = expenses.reduce((sum, t) => sum + t.amountMainCurrency, 0);
  const totalIncome = incomes.reduce((sum, t) => sum + t.amountMainCurrency, 0);

  const hasData = transactions.length > 0;

  return (
    <>
      {/* Period filter */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          paddingTop: 'var(--space-4)',
        }}
      >
        <PeriodFilter value={overviewFilter} onChange={setOverviewFilter} variant="full" />
      </div>

      {!hasData ? (
        <EmptyState
          icon={BarChart2}
          heading="No data for this period"
          body="Add some transactions to see your overview."
        />
      ) : (
        <>
          <OverviewSummary
            totalIncome={totalIncome}
            totalExpense={totalExpense}
            currency={mainCurrency}
          />

          <div
            style={{
              height: '1px',
              background: 'var(--color-border)',
              margin: '0 var(--space-4)',
            }}
          />

          <div style={{ paddingTop: 'var(--space-4)' }}>
            <SpendingBarChart
              transactions={transactions}
              start={start}
              end={end}
              currency={mainCurrency}
            />
          </div>

          <div
            style={{
              height: '1px',
              background: 'var(--color-border)',
              margin: 'var(--space-4) var(--space-4)',
            }}
          />

          <DailyAverages
            transactions={transactions}
            start={start}
            end={end}
            currency={mainCurrency}
          />

          <div
            style={{
              height: '1px',
              background: 'var(--color-border)',
              margin: 'var(--space-4) var(--space-4)',
            }}
          />

          <CategoryBreakdown
            transactions={transactions}
            currency={mainCurrency}
          />
        </>
      )}
    </>
  );
}
