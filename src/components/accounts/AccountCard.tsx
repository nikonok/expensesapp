import type { Account } from '../../db/models';
import { getLucideIcon } from '../shared/IconPicker';
import { AmountDisplay } from '../shared/AmountDisplay';

interface AccountCardProps {
  account: Account;
  onPress: () => void;
}

export default function AccountCard({ account, onPress }: AccountCardProps) {
  const Icon = getLucideIcon(account.icon);
  const isDebt = account.type === 'DEBT';
  const isSavings = account.type === 'SAVINGS';
  const hasGoal = isSavings && account.savingsGoal != null && account.savingsGoal > 0;
  const progress = hasGoal ? Math.min(1, account.balance / account.savingsGoal!) : 0;
  const hasDebtOriginalAmount = isDebt && account.debtOriginalAmount != null && account.debtOriginalAmount > 0;
  const debtProgress = hasDebtOriginalAmount
    ? Math.min(1, Math.max(0, (account.debtOriginalAmount! - account.balance) / account.debtOriginalAmount!))
    : 0;

  const typeLabel = account.type === 'REGULAR' ? 'Regular'
    : account.type === 'DEBT' ? 'Debt'
    : 'Savings';

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(0.98)';
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = '';
  };

  return (
    <button
      onClick={onPress}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{
        '--card-color': account.color,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        borderLeft: '3px solid var(--card-color)',
        cursor: 'pointer',
        transition: 'transform 80ms ease-out',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        minHeight: '64px',
        width: '100%',
        textAlign: 'left',
      } as React.CSSProperties}
    >
      {/* Icon circle */}
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: `color-mix(in oklch, var(--card-color) 20%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'var(--card-color)',
        }}
      >
        {Icon ? (
          <Icon size={18} strokeWidth={1.5} />
        ) : (
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{account.icon}</span>
        )}
      </div>

      {/* Name + type chip */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 400,
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-chip)',
              padding: '1px 6px',
              display: 'inline-block',
            }}
          >
            {typeLabel}
          </span>
          {!account.includeInTotal && (
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 400,
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-disabled)',
              }}
            >
              excluded
            </span>
          )}
        </div>

        {/* Savings progress bar */}
        {hasGoal && (
          <div
            style={{
              marginTop: '4px',
              height: '3px',
              borderRadius: '9999px',
              background: 'var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                background: 'var(--card-color)',
                borderRadius: '9999px',
                transition: 'width 300ms ease-out',
              }}
            />
          </div>
        )}

        {/* Debt payoff progress bar */}
        {isDebt && (
          <div
            style={{
              marginTop: '4px',
              height: '3px',
              borderRadius: '9999px',
              background: 'var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${debtProgress * 100}%`,
                background: 'var(--color-expense)',
                borderRadius: '9999px',
                transition: 'width 300ms ease-out',
              }}
            />
          </div>
        )}
      </div>

      {/* Balance */}
      <div role="status" style={{ flexShrink: 0, textAlign: 'right' }}>
        {isDebt ? (
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: 'var(--text-amount-md)',
              color: 'var(--color-expense)',
              textShadow: '0 0 12px oklch(62% 0.28 18 / 40%)',
            }}
          >
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: account.currency,
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(Math.abs(account.balance) / 100)}
          </span>
        ) : (
          <AmountDisplay
            amount={account.balance}
            currency={account.currency}
            type="neutral"
            size="md"
          />
        )}
      </div>
    </button>
  );
}

export function AccountCardSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        borderLeft: '3px solid var(--color-border)',
        minHeight: '64px',
      }}
    >
      <div
        className="skeleton"
        style={{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0 }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="skeleton" style={{ height: '16px', width: '60%', borderRadius: '4px' }} />
        <div className="skeleton" style={{ height: '12px', width: '30%', borderRadius: '4px' }} />
      </div>
      <div className="skeleton" style={{ height: '18px', width: '70px', borderRadius: '4px' }} />
    </div>
  );
}
