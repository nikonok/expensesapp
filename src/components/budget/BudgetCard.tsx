import { useState } from 'react';
import BottomSheet from '../layout/BottomSheet';
import { BudgetNumpad } from './BudgetNumpad';

export interface BudgetCardData {
  id: number;
  name: string;
  icon: string;
  color: string;
  planned: number | null;
  spent: number;
}

interface BudgetCardProps {
  item: BudgetCardData;
  type: 'category' | 'account';
  month: string; // "YYYY-MM"
}

export function BudgetCard({ item, type, month }: BudgetCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const isOverBudget = item.planned != null && item.planned > 0 && item.spent > item.planned;
  const progressPct =
    item.planned != null && item.planned > 0
      ? Math.min(100, (item.spent / item.planned) * 100)
      : 0;
  const showProgress = item.planned != null && item.planned > 0;

  const cardBg = isOverBudget ? 'var(--color-expense-dim)' : 'var(--color-surface)';

  const formatAmt = (n: number | null) => {
    if (n == null) return '—';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  };

  return (
    <>
      <button
        onClick={() => setSheetOpen(true)}
        aria-label={`Edit budget for ${item.name}`}
        style={
          {
            '--card-color': item.color,
            display: 'block',
            width: '100%',
            background: cardBg,
            border: 'none',
            borderLeft: '3px solid var(--card-color)',
            borderRadius: 'var(--radius-card)',
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
            overflow: 'hidden',
            transition: 'background 150ms ease-out',
            boxShadow:
              'inset 3px 0 0 var(--card-color), 0 0 8px color-mix(in oklch, var(--card-color) 15%, transparent)',
          } as React.CSSProperties
        }
      >
        {/* Card body */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {/* Top row: icon + name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '9999px',
                background: 'color-mix(in oklch, var(--card-color) 20%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '1.125rem',
                color: 'var(--card-color)',
              }}
              aria-hidden="true"
            >
              {item.icon}
            </div>
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-body)',
                color: 'var(--color-text)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </span>
          </div>

          {/* Bottom row: Budget + Spent */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
            }}
          >
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
                display: 'flex',
                gap: '4px',
                alignItems: 'baseline',
              }}
            >
              Budget:{' '}
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-amount-sm)',
                  color: 'var(--color-text)',
                }}
              >
                {formatAmt(item.planned)}
              </span>
            </span>
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
                display: 'flex',
                gap: '4px',
                alignItems: 'baseline',
              }}
            >
              Spent:{' '}
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-amount-sm)',
                  color: isOverBudget ? 'var(--color-expense)' : 'var(--color-text)',
                  textShadow: isOverBudget ? '0 0 12px oklch(62% 0.28 18 / 45%)' : undefined,
                }}
              >
                {formatAmt(item.spent)}
              </span>
            </span>
          </div>
        </div>

        {/* Progress bar — flush bottom */}
        {showProgress && (
          <div
            aria-hidden="true"
            style={{
              height: '4px',
              background: 'var(--color-border)',
              width: '100%',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: isOverBudget ? 'var(--color-expense)' : 'var(--card-color)',
                transition: 'width 300ms ease-out',
              }}
            />
          </div>
        )}
      </button>

      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={item.name}
      >
        <BudgetNumpad
          categoryId={type === 'category' ? item.id : undefined}
          accountId={type === 'account' ? item.id : undefined}
          currentMonth={month}
          currentPlanned={item.planned ?? undefined}
          itemName={item.name}
          onClose={() => setSheetOpen(false)}
        />
      </BottomSheet>
    </>
  );
}
