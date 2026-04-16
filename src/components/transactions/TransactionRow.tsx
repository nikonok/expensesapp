import { GripVertical, ArrowLeftRight, Check } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Transaction } from '../../db/models';
import type { Account } from '../../db/models';
import type { Category } from '../../db/models';
import { AmountDisplay } from '../shared/AmountDisplay';
import { getLucideIcon } from '../shared/IconPicker';
import { isDebtPayment } from '../../utils/transaction-utils';
import { useTranslation } from '../../hooks/use-translation';

interface TransactionRowProps {
  transaction: Transaction;
  account: Account;
  toAccount?: Account;
  category: Category | null;
  isSelected: boolean;
  onSelect: () => void;
}

export default function TransactionRow({
  transaction,
  account,
  toAccount,
  category,
  isSelected,
  onSelect,
}: TransactionRowProps) {
  const isTransfer = transaction.type === 'TRANSFER';
  const isOut = transaction.transferDirection === 'OUT';
  const isDebtPmt = isDebtPayment(transaction);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: transaction.id! });

  const { t } = useTranslation();

  // Debt payments use the destination account's color/icon like an expense category
  const iconColor = isDebtPmt
    ? (toAccount?.color ?? 'var(--color-expense)')
    : isTransfer
      ? 'var(--color-transfer)'
      : category?.color ?? 'var(--color-text-secondary)';

  const iconBg = isDebtPmt
    ? `color-mix(in oklch, ${toAccount?.color ?? 'var(--color-expense)'} 20%, transparent)`
    : isTransfer
      ? 'oklch(60% 0.10 265 / 15%)'
      : category
        ? `color-mix(in oklch, ${category.color} 20%, transparent)`
        : 'var(--color-surface-raised)';

  const CategoryIcon = category ? getLucideIcon(category.icon) : null;
  const AccountIcon = isDebtPmt && toAccount ? getLucideIcon(toAccount.icon) : null;

  const amountType =
    transaction.type === 'INCOME'
      ? ('income' as const)
      : (transaction.type === 'EXPENSE' || isDebtPmt)
        ? ('expense' as const)
        : ('transfer' as const);

  let centerLabel = '';
  let centerSub = '';

  if (isDebtPmt) {
    centerLabel = toAccount?.name ?? t('transactions.debtPayment.label');
    centerSub = transaction.note ?? '';
  } else if (isTransfer) {
    const fromAcc = isOut ? account : toAccount;
    const toAcc = isOut ? toAccount : account;
    centerLabel = fromAcc && toAcc ? `${fromAcc.name} → ${toAcc.name}` : 'Transfer';
    centerSub = transaction.note ?? '';
  } else {
    centerLabel = category?.name ?? 'Uncategorized';
    centerSub = transaction.note;
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minHeight: '60px',
        paddingTop: 'var(--space-3)',
        paddingBottom: 'calc(var(--space-3) + 1px)',
        paddingInline: 'var(--space-4)',
        background: isDragging
          ? 'var(--color-surface-raised)'
          : isSelected
            ? 'var(--color-primary-dim)'
            : 'transparent',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        opacity: isDragging ? 0.95 : (isTransfer && !isDebtPmt && account.type !== 'DEBT') ? 0.5 : 1,
        transition: isDragging ? 'none' : 'background 120ms ease-out',
        borderBottom: '1px solid var(--color-border)',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.5)' : 'none',
        scale: isDragging ? '1.03' : '1',
        zIndex: isDragging ? 'var(--z-sheet)' : 'auto',
        position: 'relative',
      }}
    >
      {/* Tap zone — selection, no drag listeners */}
      <button
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flex: 1,
          minWidth: 0,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        {/* Selection checkbox or icon */}
        {isSelected ? (
          <div
            style={{
              width: '32px',
              height: '32px',
              minWidth: '32px',
              borderRadius: '50%',
              background: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Check size={16} strokeWidth={2.5} color="var(--color-bg)" />
          </div>
        ) : (
          <div
            style={{
              width: '32px',
              height: '32px',
              minWidth: '32px',
              borderRadius: '50%',
              background: iconBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: iconColor,
            }}
          >
            {isDebtPmt ? (
              AccountIcon ? (
                <AccountIcon size={16} strokeWidth={1.5} />
              ) : (
                <span style={{ fontSize: '16px', lineHeight: 1 }}>{toAccount?.icon ?? '💳'}</span>
              )
            ) : isTransfer ? (
              <ArrowLeftRight size={16} strokeWidth={1.5} />
            ) : CategoryIcon ? (
              <CategoryIcon size={16} strokeWidth={1.5} />
            ) : (
              <span style={{ fontSize: '16px', lineHeight: 1 }}>{category?.icon ?? '?'}</span>
            )}
          </div>
        )}

        {/* Center: label + note */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', justifyContent: 'center', alignSelf: 'stretch' }}>
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              lineHeight: 1.2,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {centerLabel}
          </span>
          {centerSub && (
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 400,
                fontSize: 'var(--text-caption)',
                lineHeight: 1.2,
                color: 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {centerSub}
            </span>
          )}
        </div>

        {/* Amount */}
        <div style={{ flexShrink: 0, minWidth: '72px', textAlign: 'right' }}>
          <AmountDisplay
            amount={transaction.amount}
            currency={account.currency}
            type={amountType}
            size="md"
          />
        </div>
      </button>

      {/* Grip handle — drag listeners only, not tap */}
      <div
        {...listeners}
        {...attributes}
        aria-label={`Reorder ${centerLabel}`}
        data-drag-handle="true"
        style={{
          width: '44px',
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-disabled)',
          flexShrink: 0,
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <GripVertical size={16} strokeWidth={1.5} />
      </div>
    </div>
  );
}

export function TransactionRowSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minHeight: '60px',
        paddingTop: 'var(--space-3)',
        paddingBottom: 'calc(var(--space-3) + 1px)',
        paddingInline: 'var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="skeleton" style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="skeleton" style={{ height: '15px', width: '50%', borderRadius: '4px' }} />
        <div className="skeleton" style={{ height: '12px', width: '30%', borderRadius: '4px' }} />
      </div>
      <div className="skeleton" style={{ height: '15px', width: '60px', borderRadius: '4px', flexShrink: 0 }} />
    </div>
  );
}
