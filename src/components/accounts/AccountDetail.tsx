import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, ArrowDownCircle, ArrowUpCircle, List } from 'lucide-react';
import { db } from '../../db/database';
import type { Account } from '../../db/models';
import { adjustBalance } from '../../services/balance.service';
import { useUIStore } from '../../stores/ui-store';
import BottomSheet from '../layout/BottomSheet';
import { Numpad } from '../shared/Numpad';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { getLucideIcon } from '../shared/IconPicker';

interface AccountDetailProps {
  account: Account;
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
}

export default function AccountDetail({ account, isOpen, onClose, onEdit }: AccountDetailProps) {
  const navigate = useNavigate();
  const setTransactionAccountFilter = useUIStore((s) => s.setTransactionAccountFilter);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustValue, setAdjustValue] = useState('');
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const Icon = getLucideIcon(account.icon);
  const isDebt = account.type === 'DEBT';
  const isSavings = account.type === 'SAVINGS';
  const hasGoal = isSavings && account.savingsGoal != null && account.savingsGoal > 0;
  const progress = hasGoal ? Math.min(1, account.balance / account.savingsGoal!) : 0;

  const formatAmount = (v: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: account.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);

  // Debt calculations
  const monthlyRate = account.interestRateMonthly ?? (account.interestRateYearly ? account.interestRateYearly / 12 : null);
  const accruedInterest = monthlyRate != null ? Math.abs(account.balance) * monthlyRate : null;

  // Mortgage time left
  let timeLeft: string | null = null;
  if (account.mortgageStartDate && account.mortgageTermYears) {
    const start = new Date(account.mortgageStartDate);
    const endMs = start.getTime() + account.mortgageTermYears * 365.25 * 24 * 3600 * 1000;
    const nowMs = Date.now();
    const remainingMs = endMs - nowMs;
    if (remainingMs > 0) {
      const months = Math.ceil(remainingMs / (30.44 * 24 * 3600 * 1000));
      const years = Math.floor(months / 12);
      const remMonths = months % 12;
      timeLeft = years > 0 ? `${years}y ${remMonths}m` : `${remMonths}m`;
    } else {
      timeLeft = 'Overdue';
    }
  }

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      await db.accounts.update(account.id!, {
        isTrashed: true,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } finally {
      setIsArchiving(false);
      setShowArchiveConfirm(false);
    }
  };

  const handleViewTransactions = () => {
    setTransactionAccountFilter(account.id!);
    onClose();
    navigate('/transactions');
  };

  const handleAddIncome = () => {
    onClose();
    navigate(`/transactions/new?type=income&accountId=${account.id}`);
  };

  const handleAddWithdrawal = () => {
    onClose();
    navigate(`/transactions/new?type=expense&accountId=${account.id}`);
  };

  const shortcutBtnStyle: React.CSSProperties = {
    flex: 1,
    minHeight: '52px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-card)',
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    transition: 'background 80ms ease-out',
  };

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            padding: '0 var(--space-4) var(--space-8)',
          }}
        >
          {/* Account header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: `color-mix(in oklch, ${account.color} 20%, transparent)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: account.color,
              }}
            >
              {Icon ? (
                <Icon size={24} strokeWidth={1.5} />
              ) : (
                <span style={{ fontSize: '24px', lineHeight: 1 }}>{account.icon}</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'Syne, sans-serif',
                  fontWeight: 700,
                  fontSize: 'var(--text-heading)',
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {account.name}
              </div>
              <div
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-amount-md)',
                  color: isDebt ? 'var(--color-expense)' : 'var(--color-text)',
                  textShadow: isDebt ? '0 0 12px oklch(62% 0.28 18 / 40%)' : 'none',
                }}
              >
                {formatAmount(Math.abs(account.balance))}
              </div>
            </div>
            <button
              onClick={onEdit}
              style={{
                minWidth: '44px',
                minHeight: '44px',
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-btn)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
              }}
            >
              Edit
            </button>
          </div>

          {/* Savings progress */}
          {hasGoal && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
                  Progress
                </span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
                  {formatAmount(account.balance)} / {formatAmount(account.savingsGoal!)}
                </span>
              </div>
              <div style={{ height: '6px', borderRadius: '9999px', background: 'var(--color-border)' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress * 100}%`,
                    background: account.color,
                    borderRadius: '9999px',
                    transition: 'width 300ms ease-out',
                  }}
                />
              </div>
              <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
                {Math.round(progress * 100)}% of goal
              </span>
            </div>
          )}

          {/* Debt details */}
          {isDebt && (accruedInterest != null || timeLeft != null) && (
            <div
              style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-card)',
                padding: 'var(--space-3) var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              {accruedInterest != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)' }}>
                    Monthly interest
                  </span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, fontSize: 'var(--text-body)', color: 'var(--color-expense)' }}>
                    {formatAmount(accruedInterest)}
                  </span>
                </div>
              )}
              {timeLeft && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)' }}>
                    Time remaining
                  </span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, fontSize: 'var(--text-body)', color: 'var(--color-text)' }}>
                    {timeLeft}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Adjust balance */}
          {!showAdjust ? (
            <button
              onClick={() => setShowAdjust(true)}
              style={{
                minHeight: '44px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-btn)',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-body)',
              }}
            >
              Adjust Balance
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                New Balance ({account.currency})
              </span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-amount-lg)',
                  color: 'var(--color-text)',
                  textAlign: 'center',
                  padding: 'var(--space-3)',
                }}
              >
                {adjustValue || '0'}
              </span>
              <Numpad
                value={adjustValue}
                onChange={setAdjustValue}
                onSave={async (v) => {
                  await adjustBalance(account.id!, v);
                  setAdjustValue('');
                  setShowAdjust(false);
                }}
                variant="budget"
              />
              <button
                onClick={() => { setShowAdjust(false); setAdjustValue(''); }}
                style={{
                  minHeight: '44px',
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-btn)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: 'var(--text-body)',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Shortcut buttons */}
          {!showAdjust && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button onClick={handleAddIncome} style={shortcutBtnStyle}>
                <ArrowDownCircle size={20} strokeWidth={1.5} style={{ color: 'var(--color-income)' }} />
                <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', fontWeight: 500 }}>
                  Income
                </span>
              </button>
              <button onClick={handleAddWithdrawal} style={shortcutBtnStyle}>
                <ArrowUpCircle size={20} strokeWidth={1.5} style={{ color: 'var(--color-expense)' }} />
                <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', fontWeight: 500 }}>
                  Expense
                </span>
              </button>
              <button onClick={handleViewTransactions} style={shortcutBtnStyle}>
                <List size={20} strokeWidth={1.5} />
                <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', fontWeight: 500 }}>
                  Transactions
                </span>
              </button>
            </div>
          )}

          {/* Archive */}
          {!showAdjust && (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              style={{
                minHeight: '44px',
                background: 'var(--color-expense-dim)',
                border: '1px solid oklch(62% 0.28 18 / 50%)',
                borderRadius: 'var(--radius-btn)',
                color: 'var(--color-expense)',
                cursor: 'pointer',
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-body)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
              }}
            >
              <Archive size={16} strokeWidth={1.5} />
              Archive Account
            </button>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title="Archive Account?"
        body="This account will be hidden from the active list. All transactions will be preserved. You can restore it from the trash."
        confirmLabel={isArchiving ? 'Archiving…' : 'Archive'}
        onConfirm={handleArchive}
        onCancel={() => setShowArchiveConfirm(false)}
        variant="destructive"
      />
    </>
  );
}
