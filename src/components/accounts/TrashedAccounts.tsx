import { useNavigate } from 'react-router';
import { RotateCcw, Trash2 } from 'lucide-react';
import { db } from '../../db/database';
import { useAccounts } from '../../hooks/use-accounts';
import { EmptyState } from '../shared/EmptyState';
import { getLucideIcon } from '../shared/IconPicker';
import TopBar from '../layout/TopBar';

export default function TrashedAccounts() {
  const navigate = useNavigate();
  const allAccounts = useAccounts(true);
  const trashed = allAccounts.filter((a) => a.isTrashed);

  const handleRestore = async (id: number) => {
    await db.accounts.update(id, {
      isTrashed: false,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--color-bg)',
      }}
    >
      <TopBar
        title="Archived Accounts"
        rightSlot={
          <button
            onClick={() => {
              const idx = window.history.state?.idx;
              if (typeof idx === 'number' && idx > 0) {
                navigate(-1);
              } else {
                navigate('/accounts', { replace: true });
              }
            }}
            style={{
              minWidth: '44px',
              minHeight: '44px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 'var(--text-body)',
            }}
          >
            Done
          </button>
        }
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          paddingBottom: 'var(--nav-height)',
        }}
      >
        {trashed.length === 0 ? (
          <EmptyState
            icon={Trash2}
            heading="No archived accounts"
            body="Accounts you archive will appear here."
          />
        ) : (
          trashed.map((account) => {
            const Icon = getLucideIcon(account.icon);
            return (
              <div
                key={account.id}
                style={{
                  '--card-color': account.color,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-card)',
                  borderLeft: '3px solid var(--card-color)',
                  opacity: 0.7,
                } as React.CSSProperties}
              >
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
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
                  </div>
                  <div
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 500,
                      fontSize: 'var(--text-amount-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: account.currency,
                      minimumFractionDigits: 2,
                    }).format(Math.abs(account.balance))}
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(account.id!)}
                  aria-label="Restore account"
                  style={{
                    minWidth: '44px',
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-primary-dim)',
                    border: '1px solid var(--color-primary)',
                    borderRadius: 'var(--radius-btn)',
                    color: 'var(--color-primary)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <RotateCcw size={16} strokeWidth={1.5} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
