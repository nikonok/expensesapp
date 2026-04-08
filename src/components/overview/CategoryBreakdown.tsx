import { useMemo } from 'react';
import { useCategories } from '../../hooks/use-categories';
import { useAccounts } from '../../hooks/use-accounts';
import { getLucideIcon } from '../shared/IconPicker';
import { formatAmount } from '../../utils/currency-utils';
import type { Transaction } from '../../db/models';
import { isExpenseForReporting, isDebtPayment } from '../../utils/transaction-utils';

interface CategoryBreakdownProps {
  transactions: Transaction[];
  currency: string;
}

interface BreakdownRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
}

export default function CategoryBreakdown({ transactions, currency }: CategoryBreakdownProps) {
  const categories = useCategories('EXPENSE');
  const accounts = useAccounts(true); // include trashed so old debt payments still resolve

  const { rows, totalsMap, totalSpend } = useMemo(() => {
    const expenses = transactions.filter(isExpenseForReporting);

    // Aggregate by categoryId (regular expenses) or toAccountId (debt payments)
    const categoryTotals = new Map<number, number>();
    const accountTotals = new Map<number, number>();

    for (const tx of expenses) {
      if (isDebtPayment(tx) && tx.toAccountId != null) {
        accountTotals.set(tx.toAccountId, (accountTotals.get(tx.toAccountId) ?? 0) + tx.amountMainCurrency);
      } else if (tx.categoryId !== null) {
        categoryTotals.set(tx.categoryId, (categoryTotals.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
      }
    }

    // Build a unified totals map keyed by row ID string
    const totalsMap = new Map<string, number>();

    // Category rows
    for (const cat of categories) {
      const amt = categoryTotals.get(cat.id!) ?? 0;
      totalsMap.set(`cat-${cat.id}`, amt);
    }

    // Debt account rows (only accounts that have debt payments in this period)
    for (const [accountId, amt] of accountTotals) {
      totalsMap.set(`acc-${accountId}`, amt);
    }

    // Build unified row array
    const categoryRows: BreakdownRow[] = categories.map((cat) => ({
      id: `cat-${cat.id}`,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      amount: categoryTotals.get(cat.id!) ?? 0,
    }));

    const accountRows: BreakdownRow[] = [];
    for (const [accountId, amt] of accountTotals) {
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) continue;
      accountRows.push({
        id: `acc-${accountId}`,
        name: acc.name,
        icon: acc.icon,
        color: acc.color,
        amount: amt,
      });
    }

    // Sort: with-spend descending, zero-spend alphabetically
    const allRows = [...categoryRows, ...accountRows];
    const withSpend = allRows
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const withoutSpend = categoryRows // zero-spend account rows are not shown
      .filter((r) => r.amount === 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const rows = [...withSpend, ...withoutSpend];
    const totalSpend = Array.from(totalsMap.values()).reduce((s, v) => s + v, 0);
    return { rows, totalsMap, totalSpend };
  }, [transactions, categories, accounts]);

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
        {rows.map((row) => {
          const amount = totalsMap.get(row.id) ?? 0;
          const isZero = amount === 0;
          const progress = totalSpend > 0 ? amount / totalSpend : 0;
          const Icon = getLucideIcon(row.icon);
          const isEmoji = !Icon && row.icon !== '';

          return (
            <div
              key={row.id}
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
                  color: isZero ? 'var(--color-text-disabled)' : row.color,
                }}
              >
                {isEmoji ? (
                  <span style={{ fontSize: '16px', lineHeight: 1 }}>{row.icon}</span>
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
                    {row.name}
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
                      background: isZero ? 'var(--color-border)' : row.color,
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
