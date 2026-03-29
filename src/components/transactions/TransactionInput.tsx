import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronDown, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAccounts } from '@/hooks/use-accounts';
import { useCategories } from '@/hooks/use-categories';
import { useSettingsStore } from '@/stores/settings-store';
import { db } from '@/db/database';
import type { Transaction, TransactionType, CategoryType } from '@/db/models';
import type { Account, Category } from '@/db/models';
import { applyTransaction, applyTransfer, replaceTransaction, replaceTransfer } from '@/services/balance.service';
import { exchangeRateService } from '@/services/exchange-rate.service';
import { evaluateExpression } from '@/services/math-parser';
import { getLocalDateString } from '@/utils/date-utils';
import { getLucideIcon } from '@/components/shared/IconPicker';
import { Numpad } from '@/components/shared/Numpad';
import { ComingSoonStub } from '@/components/shared/ComingSoonStub';
import { useToast } from '@/components/shared/Toast';
import { useTranslation } from '@/hooks/use-translation';

// ── Types ─────────────────────────────────────────────────────────────────────

type TxTab = 'income' | 'expense' | 'transfer';
type TransferStep = 'source' | 'dest';

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

// ── Step 1: Type/category/account selector ─────────────────────────────────────

interface Step1Props {
  activeTab: TxTab;
  onTabChange: (t: TxTab) => void;
  categories: Category[];
  accounts: Account[];
  transferStep: TransferStep;
  onCategorySelect: (cat: Category) => void;
  onAccountSelect: (acc: Account) => void;
  onBack: () => void;
}

function Step1({
  activeTab,
  onTabChange,
  categories,
  accounts,
  transferStep,
  onCategorySelect,
  onAccountSelect,
  onBack,
}: Step1Props) {
  const { t } = useTranslation();

  const tabs: TxTab[] = ['income', 'expense', 'transfer'];

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

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          paddingInline: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          gap: 'var(--space-2)',
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          const color =
            tab === 'income'
              ? 'var(--color-income)'
              : tab === 'expense'
                ? 'var(--color-expense)'
                : 'var(--color-transfer)';
          return (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              style={{
                flex: 1,
                minHeight: '44px',
                background: isActive ? `color-mix(in oklch, ${color} 15%, transparent)` : 'var(--color-surface)',
                border: isActive ? `1px solid ${color}` : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-btn)',
                color: isActive ? color : 'var(--color-text-secondary)',
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-body)',
                cursor: 'pointer',
                transition: 'background 120ms, border-color 120ms, color 120ms',
              }}
            >
              {tab === 'income'
                ? t('transactions.tabs.income')
                : tab === 'expense'
                  ? t('transactions.tabs.expense')
                  : t('transactions.tabs.transfer')}
            </button>
          );
        })}
      </div>

      {/* Transfer step hint */}
      {activeTab === 'transfer' && (
        <div
          style={{
            paddingInline: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {transferStep === 'source'
              ? t('transactions.fields.from') + ': ' + t('common.transfer')
              : t('transactions.fields.to') + ': ' + t('common.transfer')}
          </span>
        </div>
      )}

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
        {activeTab !== 'transfer'
          ? categories
              .filter((c) =>
                activeTab === 'income' ? c.type === 'INCOME' : c.type === 'EXPENSE',
              )
              .map((cat) => (
                <CategoryRow key={cat.id} category={cat} onPress={() => onCategorySelect(cat)} />
              ))
          : accounts.map((acc) => (
              <AccountRow key={acc.id} account={acc} onPress={() => onAccountSelect(acc)} />
            ))}
      </div>
    </div>
  );
}

function CategoryRow({ category, onPress }: { category: Category; onPress: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onPress();
      }}
      style={{
        '--card-color': category.color,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        borderLeft: '3px solid var(--card-color)',
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
    </div>
  );
}

function AccountRow({ account, onPress }: { account: Account; onPress: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onPress();
      }}
      style={{
        '--card-color': account.color,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        borderLeft: '3px solid var(--card-color)',
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
    </div>
  );
}

// ── Picker sheet (full-screen overlay) ────────────────────────────────────────

interface PickerSheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function PickerSheet({ title, onClose, children }: PickerSheetProps) {
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

// ── Step 2: Detail form ────────────────────────────────────────────────────────

interface Step2Props {
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
}

function Step2({
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
}: Step2Props) {
  const { t } = useTranslation();
  const [pickerMode, setPickerMode] = useState<'account' | 'toAccount' | 'category' | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [noteActive, setNoteActive] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const fromCurrency = account?.currency ?? mainCurrency;
  const isTransfer = txType === 'transfer';
  const showForeignCurrency = !isTransfer && fromCurrency !== mainCurrency;
  const showTransferDestForeign = isTransfer && toAccount2ndCurrencyDiffers;

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
          {/* From account */}
          <button
            onClick={() => setPickerMode('account')}
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
            {account && (
              <EntityIcon icon={account.icon} color={account.color} size={14} />
            )}
            <span
              style={{
                flex: 1,
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
                color: account ? 'var(--color-text)' : 'var(--color-text-disabled)',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {account ? account.name : t('transactions.fields.from')}
            </span>
            <ChevronDown size={12} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          </button>

          {/* Arrow */}
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-caption)', flexShrink: 0 }}>
            →
          </span>

          {/* To: category or account */}
          <button
            onClick={() => setPickerMode(isTransfer ? 'toAccount' : 'category')}
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
            {isTransfer
              ? toAccount && <EntityIcon icon={toAccount.icon} color={toAccount.color} size={14} />
              : category && <EntityIcon icon={category.icon} color={category.color} size={14} />}
            <span
              style={{
                flex: 1,
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
                color:
                  (isTransfer ? toAccount : category)
                    ? 'var(--color-text)'
                    : 'var(--color-text-disabled)',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {isTransfer
                ? toAccount
                  ? toAccount.name
                  : t('transactions.fields.to')
                : category
                  ? category.name
                  : t('transactions.fields.category')}
            </span>
            <ChevronDown size={12} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          </button>
        </div>

        {/* Amount display */}
        <div
          style={{
            paddingInline: 'var(--space-4)',
            paddingBottom: 'var(--space-2)',
            textAlign: 'right',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
              <input
                type="number"
                inputMode="decimal"
                value={secondaryAmount}
                onChange={(e) => onSecondaryAmountChange(e.target.value)}
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
            }}
          >
            {date}
          </div>
        </div>

        {/* Numpad */}
        <Numpad
          value={numpadValue}
          onChange={onNumpadChange}
          onSave={(result) => onSave(result)}
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
              width: '280px',
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
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  onDateChange(e.target.value);
                  setShowDatePicker(false);
                }
              }}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-input)',
                padding: 'var(--space-2) var(--space-3)',
                color: 'var(--color-text)',
                fontFamily: '"DM Sans", sans-serif',
                fontSize: 'var(--text-body)',
                minHeight: '44px',
                width: '100%',
                boxSizing: 'border-box',
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
          {allAccounts.map((acc) => (
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
          {allAccounts.map((acc) => (
            <AccountRow
              key={acc.id}
              account={acc}
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
  const [step, setStep] = useState<1 | 2>(isEdit ? 2 : 1);
  const [txType, setTxType] = useState<TxTab>(() => {
    const qType = searchParams.get('type');
    if (qType === 'income' || qType === 'expense' || qType === 'transfer') return qType;
    return 'expense';
  });
  const [transferStep, setTransferStep] = useState<TransferStep>('source');

  // Detail form state
  const [account, setAccount] = useState<Account | null>(null);
  const [toAccount, setToAccount] = useState<Account | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [numpadValue, setNumpadValue] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(getLocalDateString);
  const [secondaryAmount, setSecondaryAmount] = useState('');
  const [secondaryManual, setSecondaryManual] = useState(false);
  const [toSecondaryAmount, setToSecondaryAmount] = useState('');
  const [noRateWarning, setNoRateWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

  // Determine default account (most recent transaction date, else first alphabetically)
  const defaultAccount = useLiveQuery(async () => {
    const active = await db.accounts.where('isTrashed').equals(0).toArray();
    if (active.length === 0) return null;
    const txs = await db.transactions.orderBy('date').reverse().limit(50).toArray();
    for (const tx of txs) {
      const found = active.find((a) => a.id === tx.accountId);
      if (found) return found;
    }
    return active.sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
  }, []) ?? null;

  // Whether transfer source/dest have different currencies
  const toAccount2ndCurrencyDiffers =
    Boolean(account && toAccount && account.currency !== toAccount.currency);

  // Initialize account when data loads
  useEffect(() => {
    if (account !== null) return;
    // Query param override
    const qAccountId = searchParams.get('accountId');
    if (qAccountId && allAccounts.length > 0) {
      const found = allAccounts.find((a) => a.id === parseInt(qAccountId, 10));
      if (found) { setAccount(found); return; }
    }
    if (defaultAccount) setAccount(defaultAccount);
  }, [defaultAccount, allAccounts, searchParams, account]);

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
        setStep(2);
      }
    }
  }, [allCategories, searchParams, category]);

  // Skip to step 2 if query params provide type + category or type + account
  useEffect(() => {
    const qType = searchParams.get('type');
    const qCategoryId = searchParams.get('categoryId');
    const qAccountId = searchParams.get('accountId');
    if (
      (qType === 'income' || qType === 'expense') &&
      (qCategoryId || qAccountId)
    ) {
      setStep(2);
    }
  }, [searchParams]);

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
    setTxType(typeMap[existingTx.type]);

    const foundAccount = allAccounts.find((a) => a.id === existingTx.accountId);
    if (foundAccount) setAccount(foundAccount);

    if (existingTx.type !== 'TRANSFER' && existingTx.categoryId) {
      const foundCat = allCategories.find((c) => c.id === existingTx.categoryId);
      if (foundCat) setCategory(foundCat);
    }

    if (existingTx.type === 'TRANSFER' && existingTx.transferGroupId) {
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
    }

    setNumpadValue(String(existingTx.amount));
    setNote(existingTx.note ?? '');
    setDate(existingTx.date);
    setStep(2);
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

  // Reset secondaryManual when account changes
  useEffect(() => {
    setSecondaryManual(false);
    setSecondaryAmount('');
    setNoRateWarning(false);
  }, [account]);

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

  const handleCategorySelect = useCallback(
    (cat: Category) => {
      setCategory(cat);
      const typeFromCat: TxTab = cat.type === 'INCOME' ? 'income' : 'expense';
      setTxType(typeFromCat);
      setStep(2);
    },
    [],
  );

  const handleAccountSelectTransfer = useCallback(
    (acc: Account) => {
      if (transferStep === 'source') {
        setAccount(acc);
        setTransferStep('dest');
      } else {
        setToAccount(acc);
        setStep(2);
      }
    },
    [transferStep],
  );

  const handleTabChange = useCallback((tab: TxTab) => {
    setTxType(tab);
    setTransferStep('source');
  }, []);

  const handleBack = useCallback(() => {
    if (step === 2 && !isEdit) {
      setStep(1);
    } else {
      navigate(-1);
    }
  }, [step, isEdit, navigate]);

  const handleSave = useCallback(
    async (amount: number) => {
      if (amount <= 0) {
        showToast(t('errors.positiveNumber'), 'error');
        return;
      }
      if (!account) {
        showToast(t('errors.required'), 'error');
        return;
      }
      if (txType !== 'transfer' && !category) {
        showToast(t('errors.required'), 'error');
        return;
      }
      if (txType === 'transfer') {
        if (!toAccount) {
          showToast(t('errors.required'), 'error');
          return;
        }
        if (account.id === toAccount.id) {
          showToast(t('errors.sameAccount'), 'error');
          return;
        }
      }

      setIsSaving(true);
      try {
        const now = new Date().toISOString();

        if (txType === 'transfer') {
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

        navigate(-1);
      } catch (err) {
        console.error(err);
        showToast(t('errors.generic'), 'error');
      } finally {
        setIsSaving(false);
      }
    },
    [
      account,
      toAccount,
      category,
      txType,
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
        activeTab={txType}
        onTabChange={handleTabChange}
        categories={allCategories}
        accounts={allAccounts}
        transferStep={transferStep}
        onCategorySelect={handleCategorySelect}
        onAccountSelect={handleAccountSelectTransfer}
        onBack={handleBack}
      />
    );
  }

  const filteredCategories: Category[] = allCategories.filter((c) =>
    txType === 'income' ? c.type === 'INCOME' : (c.type as CategoryType) === 'EXPENSE',
  );

  return (
    <div style={{ opacity: isSaving ? 0.6 : 1, pointerEvents: isSaving ? 'none' : undefined }}>
      <Step2
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
      />
    </div>
  );
}
