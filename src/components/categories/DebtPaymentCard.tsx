import type { Account } from '../../db/models';
import { getLucideIcon } from '../shared/IconPicker';

interface DebtPaymentCardProps {
  account: Account;
  spent: number;
  budget: number | null;
  onClick?: (account: Account) => void;
}

export default function DebtPaymentCard({
  account,
  spent,
  budget,
  onClick,
}: DebtPaymentCardProps) {
  const isOverBudget = budget !== null && spent > budget;
  const progress = budget !== null && budget > 0 ? Math.min(spent / budget, 1) : 0;

  const Icon = getLucideIcon(account.icon);
  const isEmoji = !Icon && account.icon !== '';

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        paddingBottom: '16px',
        background: isOverBudget ? 'var(--color-expense-dim)' : 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        borderLeft: `3px solid var(--card-color)`,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        ['--card-color' as string]: account.color,
        overflow: 'hidden',
        transition: 'background 120ms ease-out',
        minHeight: '44px',
      }}
      onClick={() => onClick?.(account)}
    >
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: 'var(--radius-icon)',
          background: 'var(--color-surface-raised)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: account.color,
        }}
      >
        {isEmoji ? (
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{account.icon}</span>
        ) : Icon ? (
          <Icon size={18} strokeWidth={1.5} />
        ) : null}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {account.name}
        </span>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 500,
            fontSize: 'var(--text-amount-sm)',
          }}
        >
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Budget: {budget !== null ? (budget / 100).toFixed(2) : '—'}
          </span>
          <span
            style={{
              color: 'var(--color-expense)',
            }}
          >
            Paid: {(spent / 100).toFixed(2)}
          </span>
        </div>
      </div>

      {budget !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'var(--color-border)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: isOverBudget ? 'var(--color-expense)' : 'var(--card-color)',
              transition: 'width 300ms ease-out',
            }}
          />
        </div>
      )}
    </div>
  );
}
