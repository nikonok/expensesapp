import { useMemo } from 'react';
import { useCategories } from '../../hooks/use-categories';
import { getLucideIcon } from '../shared/IconPicker';
import { formatAmount } from '../../utils/currency-utils';
import type { Transaction } from '../../db/models';

interface CategoryBreakdownProps {
  transactions: Transaction[];
  currency: string;
}

export default function CategoryBreakdown({ transactions, currency }: CategoryBreakdownProps) {
  const categories = useCategories('EXPENSE');

  const { rows, totalsMap, totalSpend } = useMemo(() => {
    const expenses = transactions.filter((t) => t.type === 'EXPENSE');

    // Aggregate by categoryId
    const totalsMap = new Map<number, number>();
    for (const tx of expenses) {
      if (tx.categoryId === null) continue;
      totalsMap.set(tx.categoryId, (totalsMap.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
    }

    // Build rows: categories with spending (sorted desc), then zero-spend (sorted alpha)
    const withSpend = categories
      .filter((c) => totalsMap.has(c.id!) && (totalsMap.get(c.id!) ?? 0) > 0)
      .sort((a, b) => (totalsMap.get(b.id!) ?? 0) - (totalsMap.get(a.id!) ?? 0));

    const withoutSpend = categories
      .filter((c) => !totalsMap.has(c.id!) || (totalsMap.get(c.id!) ?? 0) === 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const rows = [...withSpend, ...withoutSpend];
    const totalSpend = Array.from(totalsMap.values()).reduce((s, v) => s + v, 0);
    return { rows, totalsMap, totalSpend };
  }, [transactions, categories]);

  if (rows.length === 0) return null;

  return (
    <div style={{ padding: '0 var(--space-4)', paddingBottom: 'var(--space-6)' }}>
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
        Categories
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {rows.map((cat) => {
          const amount = totalsMap.get(cat.id!) ?? 0;
          const isZero = amount === 0;
          const progress = totalSpend > 0 ? amount / totalSpend : 0;
          const Icon = getLucideIcon(cat.icon);
          const isEmoji = !Icon && cat.icon !== '';

          return (
            <div
              key={cat.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) 0',
                opacity: isZero ? 0.45 : 1,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  minWidth: '32px',
                  borderRadius: 'var(--radius-icon)',
                  background: 'var(--color-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isZero ? 'var(--color-text-disabled)' : cat.color,
                }}
              >
                {isEmoji ? (
                  <span style={{ fontSize: '16px', lineHeight: 1 }}>{cat.icon}</span>
                ) : Icon ? (
                  <Icon size={16} strokeWidth={1.5} />
                ) : null}
              </div>

              {/* Name + bar */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
                      fontWeight: 500,
                      fontSize: 'var(--text-body)',
                      color: isZero ? 'var(--color-text-disabled)' : 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {cat.name}
                  </span>
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 500,
                      fontSize: 'var(--text-amount-sm)',
                      color: isZero ? 'var(--color-text-disabled)' : 'var(--color-expense)',
                      flexShrink: 0,
                    }}
                  >
                    {isZero ? '—' : formatAmount(amount, currency)}
                  </span>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    height: '3px',
                    background: 'var(--color-border)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progress * 100}%`,
                      background: isZero ? 'var(--color-border)' : cat.color,
                      borderRadius: '2px',
                      transition: 'width 300ms ease-out',
                    }}
                  />
                </div>

                {/* Percentage label */}
                {!isZero && (
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 400,
                      fontSize: 'var(--text-caption)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {Math.round(progress * 100)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
