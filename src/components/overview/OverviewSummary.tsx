import { AmountDisplay } from '../shared/AmountDisplay';
import { formatAmount } from '../../utils/currency-utils';

interface OverviewSummaryProps {
  totalIncome: number;
  totalExpense: number;
  currency: string;
}

export default function OverviewSummary({ totalIncome, totalExpense, currency }: OverviewSummaryProps) {
  const net = totalIncome - totalExpense;
  const isPositive = net >= 0;

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingTop: 'var(--space-6)',
        paddingBottom: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      {/* Net balance — hero number */}
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 600,
          fontSize: 'var(--text-display)',
          color: isPositive ? 'var(--color-income)' : 'var(--color-expense)',
          textShadow: isPositive
            ? '0 0 20px oklch(73% 0.23 160 / 40%)'
            : '0 0 20px oklch(62% 0.28 18 / 40%)',
          lineHeight: 1,
        }}
      >
        {isPositive ? '+' : '−'}
        {formatAmount(Math.abs(net), currency)}
      </div>

      {/* Income + expense row */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-6)',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 'var(--text-caption)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Income
          </span>
          <AmountDisplay amount={totalIncome} currency={currency} type="income" size="md" />
        </div>

        <div
          style={{
            width: '1px',
            height: '32px',
            background: 'var(--color-border)',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 'var(--text-caption)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Expenses
          </span>
          <AmountDisplay amount={totalExpense} currency={currency} type="expense" size="md" />
        </div>
      </div>
    </div>
  );
}
