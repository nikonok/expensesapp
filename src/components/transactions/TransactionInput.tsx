import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronDown, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAccounts } from '@/hooks/use-accounts';
import { useCategories } from '@/hooks/use-categories';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { db } from '@/db/database';
import type { Transaction, TransactionType, CategoryType } from '@/db/models';
import type { Account, Category } from '@/db/models';
import { applyTransaction, applyTransfer, replaceTransaction, replaceTransfer } from '@/services/balance.service';
import { exchangeRateService } from '@/services/exchange-rate.service';
import { evaluateExpression } from '@/services/math-parser';
import { format, parseISO } from 'date-fns';
import { getLocalDateString } from '@/utils/date-utils';
import { getLucideIcon } from '@/components/shared/IconPicker';
import { getMonthlyRate, calculatePaymentSplit } from '@/services/debt-payment.service';
import { CalendarPicker } from '@/components/shared/CalendarPicker';
import { Numpad } from '@/components/shared/Numpad';
import { ComingSoonStub } from '@/components/shared/ComingSoonStub';
import { useToast } from '@/components/shared/Toast';
import { useTranslation } from '@/hooks/use-translation';

// ── Types ─────────────────────────────────────────────────────────────────────

type TxTab = 'income' | 'expense' | 'transfer';

// ── Helper: icon renderer ──────────────────────────────────────────────────────

function EntityIcon({ icon, color, size = 18 }: { icon: string; color: string; size?: number }) {
  const Icon = getLucideIcon(icon);
  return (
    <div
      style={{
        width: size + 10,
        height: size + 10,
        borderRadius: '50%',
        background: `color-mix(in oklch, ${color} 20%, transparent)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color,
      }}
    >
      {Icon ? (
        <Icon size={size} strokeWidth={1.5} />
      ) : (
        <span style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>
      )}
    </div>
  );
}

// ── Step 1: FROM picker ─────────────────────────────────────────────────────────

interface Step1Props {
  txType: TxTab;
  categories: Category[];
  accounts: Account[];
  onFromAccountSelect: (acc: Account) => void;
  onFromIncomeCategorySelect: (cat: Category) => void;
  onBack: () => void;
}

function Step1({
  txType,
  categories,
  accounts,
  onFromAccountSelect,
  onFromIncomeCategorySelect,
  onBack,
}: Step1Props) {
  const { t } = useTranslation();

  const nonDebtAccounts = accounts.filter((a) => a.type !== 'DEBT');
  const incomeCategories = categories.filter((c) => c.type === 'INCOME');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--color-bg)',
        maxWidth: '480px',
        marginInline: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '56px',
          paddingInline: 'var(--space-4)',
          flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 0,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          {t('transactions.newTransaction')}
        </h1>
        <div style={{ minWidth: '44px' }} />
      </div>

      {/* Scrollable list */}
      <div
        className="scroll-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingInline: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          paddingBottom: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {txType === 'income' ? (
          // Income TO pre-set (from AccountDetail): user picks income category (FROM)
          incomeCategories.map((cat) => (
            <CategoryRow key={cat.id} category={cat} onPress={() => onFromIncomeCategorySelect(cat)} />
          ))
        ) : (
          <>
            {nonDebtAccounts.map((acc) => (
              <AccountRow key={acc.id} account={acc} onPress={() => onFromAccountSelect(acc)} />
            ))}
            {nonDebtAccounts.length > 0 && incomeCategories.length > 0 && (
              <div style={{ height: '1px', background: 'var(--color-border)', marginBlock: 'var(--space-1)' }} />
            )}
            {incomeCategories.map((cat) => (
              <CategoryRow key={cat.id} category={cat} onPress={() => onFromIncomeCategorySelect(cat)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Step 2: TO picker ──────────────────────────────────────────────────────────

interface Step2TOProps {
  txType: TxTab;
  fromAccountId: number | null;
  categories: Category[];
  accounts: Account[];
  onToExpenseCategorySelect: (cat: Category) => void;
  onToTransferAccountSelect: (acc: Account) => void;
  onToDebtAccountSelect: (acc: Account) => void;
  onToIncomeAccountSelect: (acc: Account) => void;
  onBack: () => void;
}

function Step2TO({
  txType,
  fromAccountId,
  categories,
  accounts,
  onToExpenseCategorySelect,
  onToTransferAccountSelect,
  onToDebtAccountSelect,
  onToIncomeAccountSelect,
  onBack,
}: Step2TOProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--color-bg)',
        maxWidth: '480px',
        marginInline: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '56px',
          paddingInline: 'var(--space-4)',
          flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 0,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          {t('transactions.newTransaction')}
        </h1>
        <div style={{ minWidth: '44px' }} />
      </div>

      {/* Scrollable list */}
      <div
        className="scroll-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingInline: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          paddingBottom: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {txType === 'income' ? (
          // Income FROM was category: show accounts as TO destination
          accounts
            .filter((a) => a.type !== 'DEBT')
            .map((acc) => (
              <AccountRow key={acc.id} account={acc} onPress={() => onToIncomeAccountSelect(acc)} />
            ))
        ) : (
          (() => {
            const debtAccounts = accounts.filter((a) => a.type === 'DEBT');
            const transferAccounts = accounts.filter(
              (a) => a.type !== 'DEBT' && a.id !== fromAccountId,
            );
            const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');
            return (
              <>
                {debtAccounts.length > 0 && (
                  <>
                    {debtAccounts.map((acc) => (
                      <AccountRow
                        key={acc.id}
                        account={acc}
                        chip="DEBT"
                        onPress={() => onToDebtAccountSelect(acc)}
                      />
                    ))}
                    {(transferAccounts.length > 0 || expenseCategories.length > 0) && (
                      <div style={{ height: '1px', background: 'var(--color-border)', marginBlock: 'var(--space-1)' }} />
                    )}
                  </>
                )}
                {transferAccounts.length > 0 && (
                  <>
                    {transferAccounts.map((acc) => (
                      <AccountRow
                        key={acc.id}
                        account={acc}
                        chip="TRANSFER"
                        chipColor="var(--color-transfer)"
                        onPress={() => onToTransferAccountSelect(acc)}
                      />
                    ))}
                    {expenseCategories.length > 0 && (
                      <div style={{ height: '1px', background: 'var(--color-border)', marginBlock: 'var(--space-1)' }} />
                    )}
                  </>
                )}
                {expenseCategories.map((cat) => (
                  <CategoryRow key={cat.id} category={cat} onPress={() => onToExpenseCategorySelect(cat)} />
                ))}
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

function CategoryRow({ category, onPress }: { category: Category; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      style={{
        '--card-color': category.color,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface)',
        border: 'none',
        borderLeft: '3px solid var(--card-color)',
        borderRadius: 'var(--radius-card)',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: '56px',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      } as React.CSSProperties}
    >
      <EntityIcon icon={category.icon} color={category.color} />
      <span
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-body)',
          color: 'var(--color-text)',
        }}
      >
        {category.name}
      </span>
    </button>
  );
}

function AccountRow({ account, onPress, chip, chipColor }: { account: Account; onPress: () => void; chip?: string; chipColor?: string }) {
  return (
    <button
      onClick={onPress}
      style={{
        '--card-color': account.color,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface)',
        border: 'none',
        borderLeft: '3px solid var(--card-color)',
        borderRadius: 'var(--radius-card)',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: '56px',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      } as React.CSSProperties}
    >
      <EntityIcon icon={account.icon} color={account.color} />
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
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {account.currency}
        </div>
      </div>
      {chip && (
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: 'var(--text-caption)',
            fontWeight: 500,
            color: chipColor ?? 'var(--color-expense)',
            background: `color-mix(in oklch, ${chipColor ?? 'var(--color-expense)'} 12%, transparent)`,
            border: `1px solid color-mix(in oklch, ${chipColor ?? 'var(--color-expense)'} 30%, transparent)`,
            borderRadius: 'var(--radius-chip)',
            padding: '2px 8px',
            flexShrink: 0,
          }}
        >
          {chip}
        </span>
      )}
    </button>
  );
}

// ── Picker sheet (full-screen overlay) ────────────────────────────────────────

interface PickerSheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function PickerSheet({ title, onClose, children }: PickerSheetProps) {
  // Close on Escape using capture phase so it fires before the form-level bubble handler
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-bg)',
        zIndex: 'var(--z-overlay)',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '480px',
        marginInline: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '56px',
          paddingInline: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 0,
          }}
        >
          <X size={20} />
        </button>
        <h2
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          {title}
        </h2>
        <div style={{ minWidth: '44px' }} />
      </div>
      <div
        className="scroll-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Step 3: Detail form ────────────────────────────────────────────────────────

interface Step3Props {
  txType: TxTab;
  account: Account | null;
  toAccount: Account | null; // transfer only
  category: Category | null; // income/expense only
  allAccounts: Account[];
  allCategories: Category[];
  numpadValue: string;
  onNumpadChange: (v: string) => void;
  onSave: (amount: number) => void;
  onBack: () => void;
  onAccountChange: (acc: Account) => void;
  onToAccountChange: (acc: Account) => void;
  onCategoryChange: (cat: Category) => void;
  note: string;
  onNoteChange: (v: string) => void;
  lastNote: string;
  date: string;
  onDateChange: (d: string) => void;
  mainCurrency: string;
  secondaryAmount: string;
  onSecondaryAmountChange: (v: string) => void;
  noRateWarning: boolean;
  isEdit: boolean;
  toSecondaryAmount: string;
  onToSecondaryAmountChange: (v: string) => void;
  toAccount2ndCurrencyDiffers: boolean;
  focusedField: 'primary' | 'secondary';
  onFocusedFieldChange: (f: 'primary' | 'secondary') => void;
  isDebtPaymentMode: boolean;
  paymentType: 'regular' | 'overpayment';
  onPaymentTypeChange: (t: 'regular' | 'overpayment') => void;
}

function Step3({
  txType,
  account,
  toAccount,
  category,
  allAccounts,
  allCategories,
  numpadValue,
  onNumpadChange,
  onSave,
  onBack,
  onAccountChange,
  onToAccountChange,
  onCategoryChange,
  note,
  onNoteChange,
  lastNote,
  date,
  onDateChange,
  mainCurrency,
  secondaryAmount,
  onSecondaryAmountChange,
  noRateWarning,
  isEdit,
  toSecondaryAmount,
  onToSecondaryAmountChange,
  toAccount2ndCurrencyDiffers,
  focusedField,
  onFocusedFieldChange,
  isDebtPaymentMode,
  paymentType,
  onPaymentTypeChange,
}: Step3Props) {
  const { t } = useTranslation();
  const [pickerMode, setPickerMode] = useState<'account' | 'toAccount' | 'category' | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [noteActive, setNoteActive] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Close date picker on Escape (capture phase so it fires before form-level bubble handler)
  useEffect(() => {
    if (!showDatePicker) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowDatePicker(false);
      }
    };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
  }, [showDatePicker]);

  const fromCurrency = account?.currency ?? mainCurrency;
  const isTransfer = txType === 'transfer';
  const showToTarget = isTransfer || isDebtPaymentMode;
  const showForeignCurrency = !showToTarget && fromCurrency !== mainCurrency;
  const showTransferDestForeign = isTransfer && toAccount2ndCurrencyDiffers;

  // Debt payment split preview
  const monthlyRate = isDebtPaymentMode && toAccount ? getMonthlyRate(toAccount) : null;
  const hasInterestRate = monthlyRate !== null;
  const currentAmount = evaluateExpression(numpadValue) ?? 0;
  const paymentSplit =
    isDebtPaymentMode && hasInterestRate && paymentType === 'regular' && currentAmount > 0 && toAccount
      ? calculatePaymentSplit(Math.abs(toAccount.balance), monthlyRate!, currentAmount)
      : null;

  const evaluatedAmount = evaluateExpression(numpadValue);

  const handleUseLastNote = () => {
    onNoteChange(lastNote);
    noteRef.current?.focus();
  };

  const handleClearLastNote = () => {
    onNoteChange('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--color-bg)',
        maxWidth: '480px',
        marginInline: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '56px',
          paddingInline: 'var(--space-4)',
          flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 0,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          {isEdit ? t('transactions.editTransaction') : t('transactions.newTransaction')}
        </h1>
        <div style={{ minWidth: '44px' }} />
      </div>

      {/* Scrollable form area */}
      <div
        className="scroll-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* From → To header row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            paddingInline: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            paddingBottom: 'var(--space-2)',
          }}
        >
          {/* From */}
          <button
            onClick={() => setPickerMode(txType === 'income' ? 'category' : 'account')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-btn)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            {txType === 'income'
              ? category && <EntityIcon icon={category.icon} color={category.color} size={14} />
              : account && <EntityIcon icon={account.icon} color={account.color} size={14} />}
            <span
              style={{
                flex: 1,
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
                color: (txType === 'income' ? category : account) ? 'var(--color-text)' : 'var(--color-text-disabled)',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {txType === 'income'
                ? category ? category.name : t('transactions.fields.from')
                : account ? account.name : t('transactions.fields.from')}
            </span>
            <ChevronDown size={12} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          </button>

          {/* Arrow */}
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-caption)', flexShrink: 0 }}>
            →
          </span>

          {/* To */}
          <button
            onClick={() => setPickerMode(txType === 'income' ? 'account' : (showToTarget ? 'toAccount' : 'category'))}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-btn)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            {txType === 'income'
              ? account && <EntityIcon icon={account.icon} color={account.color} size={14} />
              : showToTarget
                ? toAccount && <EntityIcon icon={toAccount.icon} color={toAccount.color} size={14} />
                : category && <EntityIcon icon={category.icon} color={category.color} size={14} />}
            <span
              style={{
                flex: 1,
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
                color:
                  (txType === 'income' ? account : (showToTarget ? toAccount : category))
                    ? 'var(--color-text)'
                    : 'var(--color-text-disabled)',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {txType === 'income'
                ? account ? account.name : t('transactions.fields.to')
                : showToTarget
                  ? toAccount ? toAccount.name : t('transactions.fields.to')
                  : category ? category.name : t('transactions.fields.category')}
            </span>
            <ChevronDown size={12} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          </button>
        </div>

        {/* Amount display */}
        <div
          onClick={showForeignCurrency ? () => onFocusedFieldChange('primary') : undefined}
          style={{
            paddingInline: 'var(--space-4)',
            paddingBottom: 'var(--space-2)',
            textAlign: 'right',
            cursor: showForeignCurrency ? 'pointer' : undefined,
            borderBottom: showForeignCurrency && focusedField === 'primary' ? '2px solid var(--color-primary)' : '2px solid transparent',
          }}
        >
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: 'var(--text-amount-lg)',
              color:
                txType === 'income'
                  ? 'var(--color-income)'
                  : txType === 'expense'
                    ? 'var(--color-expense)'
                    : 'var(--color-transfer)',
              textShadow:
                txType === 'income'
                  ? '0 0 12px oklch(73% 0.23 160 / 45%)'
                  : txType === 'expense'
                    ? '0 0 12px oklch(62% 0.28 18 / 45%)'
                    : undefined,
            }}
          >
            {numpadValue || '0'}
            {numpadValue && evaluatedAmount !== null && numpadValue.match(/[+\-×÷]/) && (
              <span
                style={{
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-secondary)',
                  marginLeft: 'var(--space-2)',
                }}
              >
                = {evaluatedAmount}
              </span>
            )}
          </span>
          {account && (
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
                marginLeft: 'var(--space-2)',
              }}
            >
              {fromCurrency}
            </span>
          )}
        </div>

        {/* Foreign currency secondary amount (income/expense) */}
        {showForeignCurrency && (
          <div
            style={{
              paddingInline: 'var(--space-4)',
              paddingBottom: 'var(--space-2)',
            }}
          >
            {noRateWarning && (
              <div
                style={{
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-expense)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                {t('transactions.noExchangeRate')}
              </div>
            )}
            <div
              onClick={() => onFocusedFieldChange('secondary')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                cursor: 'pointer',
                borderBottom: focusedField === 'secondary' ? '2px solid var(--color-primary)' : '2px solid transparent',
                paddingBottom: 'var(--space-1)',
              }}
            >
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                ≈
              </span>
              <div
                style={{
                  flex: 1,
                  background: 'var(--color-surface-raised)',
                  border: `1px solid ${focusedField === 'secondary' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-input)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 'var(--text-caption)',
                  color: secondaryAmount ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {secondaryAmount || '0.00'}
              </div>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                {mainCurrency}
              </span>
            </div>
          </div>
        )}

        {/* Transfer destination secondary amount */}
        {showTransferDestForeign && (
          <div
            style={{
              paddingInline: 'var(--space-4)',
              paddingBottom: 'var(--space-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                {t('transactions.fields.to')}:
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={toSecondaryAmount}
                onChange={(e) => onToSecondaryAmountChange(e.target.value)}
                placeholder="0.00"
                style={{
                  flex: 1,
                  background: 'var(--color-surface-raised)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-input)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text)',
                  minHeight: '44px',
                  outline: 'none',
                }}
              />
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                {toAccount?.currency}
              </span>
            </div>
          </div>
        )}

        {/* Debt payment type toggle + split preview */}
        {isDebtPaymentMode && hasInterestRate && (
          <div
            style={{
              paddingInline: 'var(--space-4)',
              paddingBottom: 'var(--space-3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            {/* Toggle */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {(['regular', 'overpayment'] as const).map((pt) => {
                const isActive = paymentType === pt;
                return (
                  <button
                    key={pt}
                    onClick={() => onPaymentTypeChange(pt)}
                    style={{
                      flex: 1,
                      minHeight: '44px',
                      background: isActive ? 'oklch(62% 0.28 18 / 12%)' : 'var(--color-surface)',
                      border: isActive ? '1px solid oklch(62% 0.28 18 / 50%)' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-btn)',
                      color: isActive ? 'var(--color-expense)' : 'var(--color-text-secondary)',
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 500,
                      fontSize: 'var(--text-caption)',
                      cursor: 'pointer',
                      transition: 'background 120ms, border-color 120ms, color 120ms',
                    }}
                  >
                    {pt === 'regular' ? t('transactions.debtPayment.regular') : t('transactions.debtPayment.overpayment')}
                  </button>
                );
              })}
            </div>

            {/* Split preview */}
            {paymentSplit && (
              <div
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-card)',
                  padding: 'var(--space-2) var(--space-3)',
                  display: 'flex',
                  gap: 'var(--space-3)',
                }}
              >
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
                    {t('transactions.debtPayment.interest')}
                  </span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 500, fontSize: 'var(--text-body)', color: 'var(--color-expense)' }}>
                    {paymentSplit.interestAmount.toFixed(2)}
                  </span>
                </div>
                <div style={{ width: '1px', background: 'var(--color-border)' }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
                    {t('transactions.debtPayment.principal')}
                  </span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 500, fontSize: 'var(--text-body)', color: 'var(--color-income)' }}>
                    {paymentSplit.principalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Warning when payment doesn't cover interest */}
            {isDebtPaymentMode && hasInterestRate && paymentType === 'regular' && currentAmount > 0 && paymentSplit && paymentSplit.principalAmount === 0 && (
              <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-expense)' }}>
                {t('transactions.debtPayment.noInterestCover')}
              </div>
            )}
          </div>
        )}

        {/* Note field */}
        <div
          style={{
            paddingInline: 'var(--space-4)',
            paddingBottom: 'var(--space-3)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-1)',
            }}
          >
            <label
              style={{
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {t('transactions.fields.note')}
            </label>
            <span
              style={{
                fontSize: 'var(--text-caption)',
                color: note.length > 229 ? 'var(--color-expense)' : 'var(--color-text-disabled)',
              }}
            >
              {note.length}/255
            </span>
          </div>
          <textarea
            ref={noteRef}
            rows={2}
            maxLength={255}
            value={note}
            onFocus={() => setNoteActive(true)}
            onBlur={() => setNoteActive(false)}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={!noteActive && lastNote && !note ? lastNote : ''}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--color-surface-raised)',
              border: `1px solid ${noteActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-input)',
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text)',
              resize: 'none',
              outline: noteActive ? '2px solid var(--color-primary)' : 'none',
              outlineOffset: '2px',
              boxShadow: noteActive ? '0 0 0 4px var(--color-primary-dim)' : 'none',
            }}
          />
          {/* Use last note chip */}
          {lastNote && !note && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button
                onClick={handleUseLastNote}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  background: 'var(--color-surface-raised)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-chip)',
                  padding: '4px 10px',
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  minHeight: '28px',
                }}
              >
                <span>{t('transactions.noteHint')}</span>
                <X
                  size={12}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearLastNote();
                  }}
                />
              </button>
            </div>
          )}
        </div>

        {/* Date display (read-only, edited via calendar button) */}
        <div
          style={{
            paddingInline: 'var(--space-4)',
            paddingBottom: 'var(--space-3)',
          }}
        >
          <label
            style={{
              display: 'block',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {t('transactions.fields.date')}
          </label>
          <div
            onClick={() => setShowDatePicker(true)}
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text)',
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-input)',
              padding: 'var(--space-2) var(--space-3)',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            {format(parseISO(date), 'dd.MM.yyyy')}
          </div>
        </div>

        {/* Numpad */}
        <Numpad
          value={focusedField === 'secondary' ? secondaryAmount : numpadValue}
          onChange={focusedField === 'secondary' ? onSecondaryAmountChange : onNumpadChange}
          onSave={(result) => {
            if (focusedField === 'secondary') {
              // Always save using the primary (account-currency) amount
              const primaryResult = evaluateExpression(numpadValue);
              if (primaryResult === null || primaryResult <= 0) return;
              onSave(primaryResult);
            } else {
              onSave(result);
            }
          }}
          onCalendarPress={() => setShowDatePicker(true)}
          variant="transaction"
          isTransfer={isTransfer}
        />

        {/* Repeat stub */}
        <div
          style={{
            paddingInline: 'var(--space-4)',
            paddingTop: 'var(--space-2)',
            paddingBottom: 'var(--space-6)',
          }}
        >
          <ComingSoonStub>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-btn)',
                border: '1px solid var(--color-border)',
                minHeight: '44px',
              }}
            >
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {t('transactions.repeat')}
              </span>
            </div>
          </ComingSoonStub>
        </div>
      </div>

      {/* Date picker overlay */}
      {showDatePicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 'var(--z-overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowDatePicker(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface-raised)',
              borderRadius: 'var(--radius-card)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              width: 'min(360px, calc(100vw - 32px))',
            }}
          >
            <h3
              style={{
                fontFamily: 'Syne, sans-serif',
                fontWeight: 700,
                fontSize: 'var(--text-subheading)',
                color: 'var(--color-text)',
                margin: 0,
              }}
            >
              {t('transactions.fields.date')}
            </h3>
            <CalendarPicker
              value={date}
              onChange={(d) => {
                onDateChange(d);
                setShowDatePicker(false);
              }}
            />
            <button
              onClick={() => setShowDatePicker(false)}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-btn)',
                padding: 'var(--space-2) var(--space-3)',
                color: 'var(--color-text-secondary)',
                fontFamily: '"DM Sans", sans-serif',
                fontSize: 'var(--text-body)',
                cursor: 'pointer',
                minHeight: '44px',
              }}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Picker sheets */}
      {pickerMode === 'account' && (
        <PickerSheet title={t('transactions.fields.from')} onClose={() => setPickerMode(null)}>
          {allAccounts
            .filter((acc) => (isTransfer || acc.type !== 'DEBT') && (!isTransfer || acc.id !== toAccount?.id))
            .map((acc) => (
              <AccountRow
                key={acc.id}
                account={acc}
                onPress={() => {
                  onAccountChange(acc);
                  setPickerMode(null);
                }}
              />
            ))}
        </PickerSheet>
      )}

      {pickerMode === 'toAccount' && (
        <PickerSheet title={t('transactions.fields.to')} onClose={() => setPickerMode(null)}>
          {(isDebtPaymentMode
            ? allAccounts.filter((a) => a.type === 'DEBT' && a.id !== account?.id)
            : allAccounts.filter((a) => a.id !== account?.id)
          ).map((acc) => (
            <AccountRow
              key={acc.id}
              account={acc}
              chip={isDebtPaymentMode ? 'DEBT' : undefined}
              onPress={() => {
                onToAccountChange(acc);
                setPickerMode(null);
              }}
            />
          ))}
        </PickerSheet>
      )}

      {pickerMode === 'category' && (
        <PickerSheet title={t('transactions.fields.category')} onClose={() => setPickerMode(null)}>
          {allCategories
            .filter((c) =>
              txType === 'income' ? c.type === 'INCOME' : c.type === 'EXPENSE',
            )
            .map((cat) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                onPress={() => {
                  onCategoryChange(cat);
                  setPickerMode(null);
                }}
              />
            ))}
        </PickerSheet>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TransactionInput() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { show: showToast } = useToast();
  const { mainCurrency } = useSettingsStore();
  const transactionAccountFilter = useUIStore((s) => s.transactionAccountFilter);

  const isEdit = Boolean(id);
  const editId = id ? parseInt(id, 10) : undefined;

  // Load existing transaction for edit
  const existingTx = useLiveQuery<Transaction | undefined>(
    () => (editId !== undefined ? db.transactions.get(editId) : Promise.resolve(undefined)),
    [editId],
  );

  // All data
  const allAccounts = useAccounts(false);
  const allCategories = useCategories(undefined, false);

  // Step management
  const [step, setStep] = useState<1 | 2 | 3>(isEdit ? 3 : 1);
  const [txType, setTxType] = useState<TxTab>(() => {
    const qType = searchParams.get('type');
    if (qType === 'income' || qType === 'expense') return qType;
    return 'expense';
  });
  const [paymentType, setPaymentType] = useState<'regular' | 'overpayment'>('regular');

  // Detail form state
  const [account, setAccount] = useState<Account | null>(null);
  const [toAccount, setToAccount] = useState<Account | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [numpadValue, setNumpadValue] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(getLocalDateString);
  const [secondaryAmount, setSecondaryAmount] = useState('');
  const [secondaryManual, setSecondaryManual] = useState(false);
  const [focusedField, setFocusedField] = useState<'primary' | 'secondary'>('primary');
  const [toSecondaryAmount, setToSecondaryAmount] = useState('');
  const [noRateWarning, setNoRateWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isDebtPaymentMode =
    txType === 'expense' && toAccount !== null && toAccount.type === 'DEBT' && category === null;
  const historyDepthRef = useRef(0);
  const isSavingRef = useRef(false);

  // Last note for category suggestion
  const lastNote = useLiveQuery(async () => {
    if (!category?.id) return '';
    const txs = await db.transactions
      .where('categoryId')
      .equals(category.id)
      .reverse()
      .sortBy('timestamp');
    for (const tx of txs) {
      if (tx.note && tx.note.trim()) return tx.note;
    }
    return '';
  }, [category?.id]) ?? '';

  // Determine default account from most recent transaction (skips DEBT accounts)
  const defaultAccount = useLiveQuery(async () => {
    const active = await db.accounts.filter((a) => !a.isTrashed).toArray();
    if (active.length === 0) return null;
    const txs = await db.transactions.orderBy('date').reverse().limit(50).toArray();
    for (const tx of txs) {
      const found = active.find((a) => a.id === tx.accountId && a.type !== 'DEBT');
      if (found) return found;
    }
    return null;
  }, []) ?? null;

  // Whether transfer source/dest have different currencies
  const toAccount2ndCurrencyDiffers =
    Boolean(account && toAccount && account.currency !== toAccount.currency);

  // Initialize account when data loads
  useEffect(() => {
    if (account !== null) return;
    // 1. Explicit query param
    const qAccountId = searchParams.get('accountId');
    if (qAccountId && allAccounts.length > 0) {
      const found = allAccounts.find((a) => a.id === parseInt(qAccountId, 10));
      if (found) { setAccount(found); return; }
    }
    // 2. Active account filter
    if (transactionAccountFilter !== null && allAccounts.length > 0) {
      const found = allAccounts.find((a) => a.id === transactionAccountFilter);
      if (found) { setAccount(found); return; }
    }
    // 3. Latest used account (most recent transaction)
    if (defaultAccount) setAccount(defaultAccount);
  }, [defaultAccount, allAccounts, searchParams, account, transactionAccountFilter]);

  // Initialize category from query param
  useEffect(() => {
    if (category !== null) return;
    const qCategoryId = searchParams.get('categoryId');
    if (qCategoryId && allCategories.length > 0) {
      const found = allCategories.find((c) => c.id === parseInt(qCategoryId, 10));
      if (found) {
        setCategory(found);
        const typeFromCat: TxTab = found.type === 'INCOME' ? 'income' : 'expense';
        setTxType(typeFromCat);
      }
    }
  }, [allCategories, searchParams, category]);

  // Step-skip logic based on query params and active filter
  useEffect(() => {
    if (isEdit) return;
    const qType = searchParams.get('type');
    const qCategoryId = searchParams.get('categoryId');
    const qAccountId = searchParams.get('accountId');

    if (qCategoryId) {
      // CategoryList: category pre-set, go straight to amount form
      setStep(3);
    } else if (qType === 'expense' && qAccountId) {
      // AccountDetail Expense: FROM account pre-set, user picks TO
      setStep(2);
    } else if (transactionAccountFilter !== null) {
      // Account filter active: FROM account pre-set, user picks TO
      setStep(2);
    }
    // AccountDetail Income (qType=income&accountId): stay at step 1, show income categories
    // No pre-determination: start at step 1
  }, [searchParams, transactionAccountFilter, isEdit]);

  const initialised = useRef(false);

  // Populate edit fields when existing tx loads
  useEffect(() => {
    if (!isEdit || !existingTx || allAccounts.length === 0 || allCategories.length === 0) return;
    if (initialised.current) return;
    initialised.current = true;

    const typeMap: Record<TransactionType, TxTab> = {
      INCOME: 'income',
      EXPENSE: 'expense',
      TRANSFER: 'transfer',
    };
    const foundAccount = allAccounts.find((a) => a.id === existingTx.accountId);
    if (foundAccount) setAccount(foundAccount);

    if (existingTx.type === 'TRANSFER' && existingTx.toAccountId != null) {
      // Debt payment — restore as expense + debt account mode
      setTxType('expense');
      // Look up dest account directly from DB so trashed accounts are found
      db.accounts.get(existingTx.toAccountId).then((dest) => {
        if (dest) setToAccount(dest);
      });
      setPaymentType(existingTx.interestAmount != null ? 'regular' : 'overpayment');
    } else if (existingTx.type === 'TRANSFER' && existingTx.transferGroupId) {
      setTxType('transfer');
      // Load the other half of the transfer
      db.transactions
        .where('transferGroupId')
        .equals(existingTx.transferGroupId)
        .toArray()
        .then((records) => {
          const other = records.find((r) => r.id !== existingTx.id);
          if (other) {
            const dest = allAccounts.find((a) => a.id === other.accountId);
            if (dest) setToAccount(dest);
          }
        });
    } else {
      setTxType(typeMap[existingTx.type]);
      if (existingTx.categoryId) {
        const foundCat = allCategories.find((c) => c.id === existingTx.categoryId);
        if (foundCat) setCategory(foundCat);
      }
    }

    setNumpadValue(String(existingTx.amount));
    setNote(existingTx.note ?? '');
    setDate(existingTx.date);
    setStep(3);
  }, [isEdit, existingTx, allAccounts, allCategories]);

  // Auto-calc secondary amount when numpad changes (income/expense foreign currency)
  useEffect(() => {
    if (secondaryManual) return;
    if (!account || account.currency === mainCurrency) return;
    const amount = evaluateExpression(numpadValue);
    if (amount === null || amount <= 0) {
      setSecondaryAmount('');
      return;
    }
    exchangeRateService
      .getRate(account.currency, mainCurrency)
      .then((rate) => {
        if (rate === null) {
          setNoRateWarning(true);
          setSecondaryAmount(String(amount));
        } else {
          setNoRateWarning(false);
          setSecondaryAmount(String(Math.round(amount * rate * 100) / 100));
        }
      })
      .catch(() => {
        setNoRateWarning(true);
        setSecondaryAmount(String(amount));
      });
  }, [numpadValue, account, mainCurrency, secondaryManual]);

  // Reset secondaryManual and focusedField when account changes
  useEffect(() => {
    setSecondaryManual(false);
    setSecondaryAmount('');
    setNoRateWarning(false);
    setFocusedField('primary');
  }, [account]);

  // Reset secondaryManual when switching back to primary field
  useEffect(() => {
    if (focusedField === 'primary') {
      setSecondaryManual(false);
    }
  }, [focusedField]);

  // Handle browser back button: go back one step per history push
  useEffect(() => {
    const h = () => {
      if (historyDepthRef.current > 0 && !isSavingRef.current) {
        historyDepthRef.current--;
        setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3);
      }
    };
    window.addEventListener('popstate', h);
    return () => window.removeEventListener('popstate', h);
  }, []);

  // Auto-calc transfer dest amount when source changes
  useEffect(() => {
    if (!toAccount2ndCurrencyDiffers || !account || !toAccount) return;
    const amount = evaluateExpression(numpadValue);
    if (amount === null || amount <= 0) {
      setToSecondaryAmount('');
      return;
    }
    exchangeRateService
      .getRate(account.currency, toAccount.currency)
      .then((rate) => {
        if (rate !== null) {
          setToSecondaryAmount(String(Math.round(amount * rate * 100) / 100));
        }
      })
      .catch(() => {});
  }, [numpadValue, account, toAccount, toAccount2ndCurrencyDiffers]);

  const handleSecondaryAmountChange = (v: string) => {
    setSecondaryAmount(v);
    setSecondaryManual(true);
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  // Step 1 → 2: FROM account selected
  const handleFromAccountSelect = useCallback((acc: Account) => {
    setAccount(acc);
    setTxType('expense');
    setCategory(null);
    history.pushState(null, '', window.location.href);
    historyDepthRef.current++;
    setStep(2);
  }, []);

  // Step 1 → 2 (or 3 if TO pre-set): FROM income category selected
  const handleFromIncomeCategorySelect = useCallback((cat: Category) => {
    setCategory(cat);
    setTxType('income');
    history.pushState(null, '', window.location.href);
    historyDepthRef.current++;
    // If income destination account is already pre-set (from AccountDetail or filter), skip step 2
    const qAccountId = searchParams.get('accountId');
    const hasPresetAccount = account !== null ||
      (qAccountId !== null && allAccounts.some((a) => a.id === parseInt(qAccountId, 10)));
    if (hasPresetAccount) {
      setStep(3);
    } else {
      setStep(2);
    }
  }, [account, allAccounts, searchParams]);

  // Step 2 → 3: TO expense category selected
  const handleCategorySelect = useCallback((cat: Category) => {
    setCategory(cat);
    setToAccount(null);
    const typeFromCat: TxTab = cat.type === 'INCOME' ? 'income' : 'expense';
    setTxType(typeFromCat);
    history.pushState(null, '', window.location.href);
    historyDepthRef.current++;
    setStep(3);
  }, []);

  // Step 2 → 3: TO debt account selected
  const handleDebtAccountSelect = useCallback((acc: Account) => {
    setToAccount(acc);
    setCategory(null);
    setTxType('expense');
    setPaymentType('regular');
    history.pushState(null, '', window.location.href);
    historyDepthRef.current++;
    setStep(3);
  }, []);

  // Step 2 → 3: TO transfer account selected
  const handleTransferAccountSelect = useCallback((acc: Account) => {
    if (!account) return;
    if (account.id === acc.id) {
      showToast(t('errors.sameAccount'), 'error');
      return;
    }
    setToAccount(acc);
    setCategory(null);
    setTxType('transfer');
    history.pushState(null, '', window.location.href);
    historyDepthRef.current++;
    setStep(3);
  }, [account, showToast, t]);

  // Step 2 → 3: TO income account selected
  const handleToIncomeAccountSelect = useCallback((acc: Account) => {
    setAccount(acc);
    history.pushState(null, '', window.location.href);
    historyDepthRef.current++;
    setStep(3);
  }, []);

  const handleBack = useCallback(() => {
    if (step > 1 && !isEdit) {
      if (historyDepthRef.current > 0) {
        history.back();
      } else {
        setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3);
      }
    } else {
      const idx = window.history.state?.idx;
      if (typeof idx === 'number' && idx > 0) {
        navigate(-1);
      } else {
        navigate('/transactions', { replace: true });
      }
    }
  }, [step, isEdit, navigate]);

  // Escape key: close form (inner overlays handle Escape via capture-phase listeners)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleBack();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [handleBack]);

  const handleSave = useCallback(
    async (amount: number) => {
      if (amount <= 0) {
        showToast(t('errors.positiveNumber'), 'error');
        return;
      }
      if (!account) {
        showToast(t('errors.accountRequired'), 'error');
        return;
      }
      const isDebtPmt = isDebtPaymentMode;
      if (txType !== 'transfer' && !category && !isDebtPmt) {
        showToast(t('errors.categoryRequired'), 'error');
        return;
      }
      if (txType === 'transfer') {
        if (!toAccount) {
          showToast(t('errors.toAccountRequired'), 'error');
          return;
        }
        if (account.id === toAccount.id) {
          showToast(t('errors.sameAccount'), 'error');
          return;
        }
      }
      if (isDebtPmt && account.id === toAccount!.id) {
        showToast(t('errors.sameAccount'), 'error');
        return;
      }

      setIsSaving(true);
      isSavingRef.current = true;
      try {
        const now = new Date().toISOString();

        if (isDebtPmt) {
          // Debt payment — store as TRANSFER pair with toAccountId metadata
          const outRate = await exchangeRateService
            .getRate(account.currency, mainCurrency)
            .then((r) => r ?? 1)
            .catch(() => 1);

          const outAmountMain = Math.round(amount * outRate * 100) / 100;

          // Same-currency: inAmount = amount; cross-currency: use rate to dest account
          let inAmount = amount;
          let inRate = outRate;
          if (toAccount!.currency !== account.currency) {
            const crossRate = await exchangeRateService
              .getRate(account.currency, toAccount!.currency)
              .then((r) => r ?? 1)
              .catch(() => 1);
            inAmount = Math.round(amount * crossRate * 100) / 100;
            inRate = await exchangeRateService
              .getRate(toAccount!.currency, mainCurrency)
              .then((r) => r ?? 1)
              .catch(() => 1);
          }

          // Compute split metadata
          const monthlyRate = getMonthlyRate(toAccount!);
          let interestAmt: number | null = null;
          let principalAmt: number | null = null;
          if (monthlyRate !== null && paymentType === 'regular') {
            const split = calculatePaymentSplit(Math.abs(toAccount!.balance), monthlyRate, amount);
            interestAmt = split.interestAmount;
            principalAmt = split.principalAmount;
          }

          const groupId = crypto.randomUUID();

          const outTx: Transaction = {
            type: 'TRANSFER',
            date,
            timestamp: now,
            displayOrder: 0,
            accountId: account.id!,
            categoryId: null,
            currency: account.currency,
            amount,
            amountMainCurrency: outAmountMain,
            exchangeRate: outRate,
            note: note.trim(),
            transferGroupId: groupId,
            transferDirection: 'OUT',
            toAccountId: toAccount!.id!,
            interestAmount: interestAmt,
            principalAmount: principalAmt,
            createdAt: now,
            updatedAt: now,
          };

          const inTx: Transaction = {
            type: 'TRANSFER',
            date,
            timestamp: now,
            displayOrder: 0,
            accountId: toAccount!.id!,
            categoryId: null,
            currency: toAccount!.currency,
            amount: inAmount,
            amountMainCurrency: Math.round(inAmount * inRate * 100) / 100,
            exchangeRate: inRate,
            note: note.trim(),
            transferGroupId: groupId,
            transferDirection: 'IN',
            createdAt: now,
            updatedAt: now,
          };

          if (isEdit && existingTx?.transferGroupId) {
            await replaceTransfer(existingTx.transferGroupId, outTx, inTx);
          } else {
            await applyTransfer(outTx, inTx);
          }
        } else if (txType === 'transfer') {
          // Calculate exchange rates
          const outRate = await exchangeRateService
            .getRate(account.currency, mainCurrency)
            .then((r) => r ?? 1)
            .catch(() => 1);

          const outAmountMain = Math.round(amount * outRate * 100) / 100;

          let inAmount = amount;
          let inRate = outRate;

          if (toAccount2ndCurrencyDiffers && toAccount) {
            // Cross-currency transfer
            const crossRate = await exchangeRateService
              .getRate(account.currency, toAccount.currency)
              .then((r) => r ?? 1)
              .catch(() => 1);

            if (toSecondaryAmount && parseFloat(toSecondaryAmount) > 0) {
              inAmount = parseFloat(toSecondaryAmount);
            } else {
              inAmount = Math.round(amount * crossRate * 100) / 100;
            }

            const toRate = await exchangeRateService
              .getRate(toAccount.currency, mainCurrency)
              .then((r) => r ?? 1)
              .catch(() => 1);
            inRate = toRate;
          }

          const groupId = crypto.randomUUID();

          const outTx: Transaction = {
            type: 'TRANSFER',
            date,
            timestamp: now,
            displayOrder: 0,
            accountId: account.id!,
            categoryId: null,
            currency: account.currency,
            amount,
            amountMainCurrency: outAmountMain,
            exchangeRate: outRate,
            note: note.trim(),
            transferGroupId: groupId,
            transferDirection: 'OUT',
            createdAt: now,
            updatedAt: now,
          };

          const inTx: Transaction = {
            type: 'TRANSFER',
            date,
            timestamp: now,
            displayOrder: 0,
            accountId: toAccount!.id!,
            categoryId: null,
            currency: toAccount!.currency,
            amount: inAmount,
            amountMainCurrency: Math.round(inAmount * inRate * 100) / 100,
            exchangeRate: inRate,
            note: note.trim(),
            transferGroupId: groupId,
            transferDirection: 'IN',
            createdAt: now,
            updatedAt: now,
          };

          if (isEdit && existingTx?.transferGroupId) {
            await replaceTransfer(existingTx.transferGroupId, outTx, inTx);
          } else {
            await applyTransfer(outTx, inTx);
          }
        } else {
          // Income or expense
          const rate = await exchangeRateService
            .getRate(account.currency, mainCurrency)
            .then((r) => r ?? 1)
            .catch(() => 1);

          let amountMain: number;
          if (secondaryManual && secondaryAmount && parseFloat(secondaryAmount) > 0) {
            amountMain = parseFloat(secondaryAmount);
          } else {
            amountMain = Math.round(amount * rate * 100) / 100;
          }

          const tx: Transaction = {
            type: txType === 'income' ? 'INCOME' : 'EXPENSE',
            date,
            timestamp: now,
            displayOrder: 0,
            accountId: account.id!,
            categoryId: category!.id!,
            currency: account.currency,
            amount,
            amountMainCurrency: amountMain,
            exchangeRate: rate,
            note: note.trim(),
            transferGroupId: null,
            transferDirection: null,
            createdAt: now,
            updatedAt: now,
          };

          if (isEdit && existingTx) {
            await replaceTransaction(existingTx, tx);
          } else {
            await applyTransaction(tx);
          }
        }

        navigate(-(historyDepthRef.current + 1));
        // isSavingRef stays true — component unmounts after navigate, no cleanup needed
      } catch (err) {
        console.error(err);
        showToast(t('errors.generic'), 'error');
        isSavingRef.current = false;
      } finally {
        setIsSaving(false);
      }
    },
    [
      account,
      toAccount,
      category,
      txType,
      paymentType,
      date,
      note,
      mainCurrency,
      secondaryAmount,
      secondaryManual,
      toSecondaryAmount,
      toAccount2ndCurrencyDiffers,
      isEdit,
      existingTx,
      navigate,
      showToast,
      t,
    ],
  );

  // ── Loading guard ──────────────────────────────────────────────────────────

  if (isEdit && existingTx === undefined && editId !== undefined) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg)',
        }}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <Step1
        txType={txType}
        categories={allCategories}
        accounts={allAccounts}
        onFromAccountSelect={handleFromAccountSelect}
        onFromIncomeCategorySelect={handleFromIncomeCategorySelect}
        onBack={handleBack}
      />
    );
  }

  if (step === 2) {
    return (
      <Step2TO
        txType={txType}
        fromAccountId={account?.id ?? null}
        categories={allCategories}
        accounts={allAccounts}
        onToExpenseCategorySelect={handleCategorySelect}
        onToTransferAccountSelect={handleTransferAccountSelect}
        onToDebtAccountSelect={handleDebtAccountSelect}
        onToIncomeAccountSelect={handleToIncomeAccountSelect}
        onBack={handleBack}
      />
    );
  }

  const filteredCategories: Category[] = allCategories.filter((c) =>
    txType === 'income' ? c.type === 'INCOME' : (c.type as CategoryType) === 'EXPENSE',
  );

  return (
    <div style={{ opacity: isSaving ? 0.6 : 1, pointerEvents: isSaving ? 'none' : undefined }}>
      <Step3
        txType={txType}
        account={account}
        toAccount={toAccount}
        category={category}
        allAccounts={allAccounts}
        allCategories={filteredCategories}
        numpadValue={numpadValue}
        onNumpadChange={setNumpadValue}
        onSave={handleSave}
        onBack={handleBack}
        onAccountChange={setAccount}
        onToAccountChange={setToAccount}
        onCategoryChange={setCategory}
        note={note}
        onNoteChange={setNote}
        lastNote={lastNote}
        date={date}
        onDateChange={setDate}
        mainCurrency={mainCurrency}
        secondaryAmount={secondaryAmount}
        onSecondaryAmountChange={handleSecondaryAmountChange}
        noRateWarning={noRateWarning}
        isEdit={isEdit}
        toSecondaryAmount={toSecondaryAmount}
        onToSecondaryAmountChange={setToSecondaryAmount}
        toAccount2ndCurrencyDiffers={toAccount2ndCurrencyDiffers}
        focusedField={focusedField}
        onFocusedFieldChange={setFocusedField}
        isDebtPaymentMode={isDebtPaymentMode}
        paymentType={paymentType}
        onPaymentTypeChange={setPaymentType}
      />
    </div>
  );
}
