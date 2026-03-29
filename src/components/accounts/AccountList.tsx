import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useAccounts } from '../../hooks/use-accounts';
import type { Account, AccountType } from '../../db/models';
import TotalWealth from './TotalWealth';
import AccountCard from './AccountCard';
import AccountForm from './AccountForm';
import AccountDetail from './AccountDetail';
import { EmptyState } from '../shared/EmptyState';

const TYPE_ORDER: AccountType[] = ['REGULAR', 'DEBT', 'SAVINGS'];
const TYPE_LABEL: Record<AccountType, string> = {
  REGULAR: 'Regular',
  DEBT: 'Debt',
  SAVINGS: 'Savings',
};

export default function AccountList() {
  const navigate = useNavigate();
  const accounts = useAccounts(false);

  const [showNewForm, setShowNewForm] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | undefined>(undefined);
  const [detailAccount, setDetailAccount] = useState<Account | undefined>(undefined);

  // Group by type in order
  const grouped: Record<AccountType, Account[]> = {
    REGULAR: [],
    DEBT: [],
    SAVINGS: [],
  };
  for (const acc of accounts) {
    grouped[acc.type].push(acc);
  }

  const hasAny = accounts.length > 0;

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        paddingBottom: 'calc(var(--nav-height) + 72px)',
        position: 'relative',
      }}
    >
      {/* Trash icon — shown in the page, not via TopBar since TabLayout owns TopBar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
        <button
          aria-label="View archived accounts"
          onClick={() => navigate('/accounts/trash')}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Trash2 size={20} strokeWidth={1.5} />
        </button>
      </div>

      {hasAny && <TotalWealth />}

      {!hasAny && (
        <EmptyState
          icon={Wallet}
          heading="No accounts yet"
          body="Create your first account to start tracking your finances."
          action={{ label: 'Add Account', onClick: () => setShowNewForm(true) }}
        />
      )}

      {TYPE_ORDER.map((type) => {
        const list = grouped[type];
        if (list.length === 0) return null;
        return (
          <div key={type} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                paddingInline: 'var(--space-1)',
                paddingTop: 'var(--space-2)',
              }}
            >
              {TYPE_LABEL[type]}
            </span>
            {list.map((acc) => (
              <AccountCard
                key={acc.id}
                account={acc}
                onPress={() => setDetailAccount(acc)}
              />
            ))}
          </div>
        );
      })}

      {/* FAB */}
      <button
        aria-label="Add account"
        onClick={() => setShowNewForm(true)}
        style={{
          position: 'fixed',
          right: 'var(--space-4)',
          bottom: 'calc(var(--nav-height) + var(--space-4))',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--color-primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 'var(--z-fab)',
          boxShadow: '0 4px 20px oklch(72% 0.22 210 / 40%)',
          color: 'var(--color-bg)',
          transition: 'transform 80ms ease-out',
        }}
        onPointerDown={(e) => { e.currentTarget.style.transform = 'scale(0.93)'; }}
        onPointerUp={(e) => { e.currentTarget.style.transform = ''; }}
        onPointerLeave={(e) => { e.currentTarget.style.transform = ''; }}
      >
        <Plus size={28} strokeWidth={2} />
      </button>

      {/* New Account Form */}
      <AccountForm
        isOpen={showNewForm}
        onClose={() => setShowNewForm(false)}
      />

      {/* Edit Account Form */}
      <AccountForm
        isOpen={!!editAccount}
        onClose={() => setEditAccount(undefined)}
        editAccount={editAccount}
      />

      {/* Account Detail */}
      {detailAccount && (
        <AccountDetail
          account={detailAccount}
          isOpen={!!detailAccount}
          onClose={() => setDetailAccount(undefined)}
          onEdit={() => {
            setEditAccount(detailAccount);
            setDetailAccount(undefined);
          }}
        />
      )}
    </div>
  );
}
