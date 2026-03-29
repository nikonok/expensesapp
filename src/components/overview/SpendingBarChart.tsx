import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useState, useMemo } from 'react';
import {
  format,
  startOfHour,
  addHours,
  startOfDay,
  addDays,
  startOfWeek,
  addWeeks,
  startOfMonth,
  addMonths,
  isBefore,
  isAfter,
} from 'date-fns';
import { autoScaleChartBuckets } from '../../utils/date-utils';
import { formatAmount } from '../../utils/currency-utils';
import type { Transaction } from '../../db/models';

interface SpendingBarChartProps {
  transactions: Transaction[];
  start: Date;
  end: Date;
  currency: string;
}

interface BucketData {
  label: string;
  amount: number;
}

function buildBuckets(transactions: Transaction[], start: Date, end: Date, scale: 'hour' | 'day' | 'week' | 'month'): BucketData[] {
  const buckets: BucketData[] = [];

  if (scale === 'hour') {
    const dayStart = startOfDay(start);
    for (let h = 0; h < 24; h++) {
      const bucketStart = addHours(dayStart, h);
      const bucketEnd = addHours(dayStart, h + 1);
      buckets.push({
        label: format(bucketStart, 'HH:mm'),
        amount: 0,
      });
      const _ = { bucketStart, bucketEnd };
      void _;
    }
    for (const tx of transactions) {
      if (tx.type !== 'EXPENSE') continue;
      const txDate = new Date(tx.timestamp);
      const h = txDate.getHours();
      if (h >= 0 && h < 24) {
        buckets[h].amount += tx.amountMainCurrency;
      }
    }
  } else if (scale === 'day') {
    let cursor = startOfDay(start);
    while (!isAfter(cursor, end)) {
      buckets.push({
        label: format(cursor, 'dd.MM'),
        amount: 0,
      });
      cursor = addDays(cursor, 1);
    }
    for (const tx of transactions) {
      if (tx.type !== 'EXPENSE') continue;
      const txDay = startOfDay(new Date(tx.date + 'T00:00:00'));
      const dayStart2 = startOfDay(start);
      const diffMs = txDay.getTime() - dayStart2.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < buckets.length) {
        buckets[diffDays].amount += tx.amountMainCurrency;
      }
    }
  } else if (scale === 'week') {
    let cursor = startOfWeek(start, { weekStartsOn: 1 });
    while (!isAfter(cursor, end)) {
      const weekEnd = addDays(addWeeks(cursor, 1), -1);
      const labelEnd = isBefore(weekEnd, end) ? weekEnd : end;
      const labelStart = isBefore(cursor, start) ? start : cursor;
      const label = format(labelStart, 'dd.MM') + (format(labelStart, 'dd.MM') !== format(labelEnd, 'dd.MM') ? '–' + format(labelEnd, 'dd') : '');
      buckets.push({ label, amount: 0 });
      cursor = addWeeks(cursor, 1);
    }

    // Map transactions to week buckets
    const weekCursors: Date[] = [];
    let wc = startOfWeek(start, { weekStartsOn: 1 });
    while (!isAfter(wc, end)) {
      weekCursors.push(wc);
      wc = addWeeks(wc, 1);
    }

    for (const tx of transactions) {
      if (tx.type !== 'EXPENSE') continue;
      const txDay = new Date(tx.date + 'T00:00:00');
      for (let i = 0; i < weekCursors.length; i++) {
        const wStart = weekCursors[i];
        const wEnd = addWeeks(wStart, 1);
        if (!isBefore(txDay, wStart) && isBefore(txDay, wEnd)) {
          buckets[i].amount += tx.amountMainCurrency;
          break;
        }
      }
    }
  } else {
    // month
    let cursor = startOfMonth(start);
    while (!isAfter(cursor, end)) {
      buckets.push({
        label: format(cursor, 'MM.yy'),
        amount: 0,
      });
      cursor = addMonths(cursor, 1);
    }

    const monthCursors: Date[] = [];
    let mc = startOfMonth(start);
    while (!isAfter(mc, end)) {
      monthCursors.push(mc);
      mc = addMonths(mc, 1);
    }

    for (const tx of transactions) {
      if (tx.type !== 'EXPENSE') continue;
      const txDay = new Date(tx.date + 'T00:00:00');
      for (let i = 0; i < monthCursors.length; i++) {
        const mStart = monthCursors[i];
        const mEnd = addMonths(mStart, 1);
        if (!isBefore(txDay, mStart) && isBefore(txDay, mEnd)) {
          buckets[i].amount += tx.amountMainCurrency;
          break;
        }
      }
    }
  }

  return buckets;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  currency: string;
}

function CustomTooltip({ active, payload, label, currency }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
  return (
    <div
      style={{
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 'var(--radius-tooltip)',
        padding: '6px 10px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-secondary)',
          marginBottom: '2px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 600,
          fontSize: 'var(--text-amount-sm)',
          color: 'var(--color-expense)',
        }}
      >
        {formatAmount(value, currency)}
      </div>
    </div>
  );
}

export default function SpendingBarChart({ transactions, start, end, currency }: SpendingBarChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const scale = autoScaleChartBuckets(start, end);
  const buckets = useMemo(() => buildBuckets(transactions, start, end, scale), [transactions, start, end, scale]);

  const maxAmount = Math.max(...buckets.map((b) => b.amount), 0);

  // Limit labels shown to avoid crowding
  const totalBuckets = buckets.length;
  const labelInterval = totalBuckets > 20 ? Math.ceil(totalBuckets / 10) - 1 : totalBuckets > 10 ? 1 : 0;

  return (
    <div style={{ padding: '0 var(--space-4)', paddingBottom: 'var(--space-2)' }}>
      <div
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 'var(--space-3)',
        }}
      >
        Spending
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          data={buckets}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="20%"
          onMouseLeave={() => setActiveIndex(null)}
        >
          <CartesianGrid
            vertical={false}
            stroke="oklch(22% 0.04 265 / 50%)"
            strokeDasharray="0"
          />
          <XAxis
            dataKey="label"
            tick={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 10,
              fill: 'var(--color-text-secondary)',
            }}
            axisLine={false}
            tickLine={false}
            interval={labelInterval}
          />
          <YAxis hide />
          <Tooltip
            content={<CustomTooltip currency={currency} />}
            cursor={false}
          />
          <Bar
            dataKey="amount"
            radius={[4, 4, 0, 0]}
            isAnimationActive
            animationDuration={300}
            animationEasing="ease-out"
            onMouseEnter={(_data, index) => setActiveIndex(index)}
          >
            {buckets.map((entry, index) => {
              const isActive = index === activeIndex;
              if (entry.amount === 0) {
                // 2px stub bar for zero values using a min height trick
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill="var(--color-border)"
                    style={{ minHeight: '2px' }}
                  />
                );
              }
              return (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    isActive
                      ? 'var(--color-primary)'
                      : 'oklch(72% 0.22 210 / 70%)'
                  }
                  style={{
                    filter: isActive
                      ? 'drop-shadow(0 0 6px var(--color-primary))'
                      : 'none',
                    transition: 'fill 150ms ease-out, filter 150ms ease-out',
                  }}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {maxAmount === 0 && (
        <div
          style={{
            textAlign: 'center',
            fontFamily: '"DM Sans", sans-serif',
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-disabled)',
            marginTop: 'var(--space-2)',
          }}
        >
          No expenses in this period
        </div>
      )}
    </div>
  );
}
