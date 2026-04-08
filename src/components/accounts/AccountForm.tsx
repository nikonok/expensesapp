import { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { db } from '../../db/database';
import type { Account, AccountType } from '../../db/models';
import { accountSchema } from '../../utils/validation';
import BottomSheet from '../layout/BottomSheet';
import { ColorPicker } from '../shared/ColorPicker';
import { IconPicker } from '../shared/IconPicker';
import { CurrencyPicker } from '../shared/CurrencyPicker';
import { Numpad } from '../shared/Numpad';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { COLOR_PALETTE } from '../../utils/constants';
import { useSettingsStore } from '../../stores/settings-store';

interface AccountFormProps {
  isOpen: boolean;
  onClose: () => void;
  editAccount?: Account;
}

const DEFAULT_COLOR = COLOR_PALETTE[14].value; // cyan
const DEFAULT_ICON = 'wallet';

export default function AccountForm({ isOpen, onClose, editAccount }: AccountFormProps) {
  const isEdit = !!editAccount;
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('REGULAR');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [currency, setCurrency] = useState(mainCurrency);
  const [description, setDescription] = useState('');
  const [startingBalance, setStartingBalance] = useState('');
  const [includeInTotal, setIncludeInTotal] = useState(true);
  const [savingsGoal, setSavingsGoal] = useState('');
  const [interestRateYearly, setInterestRateYearly] = useState('');
  const [interestRateMonthly, setInterestRateMonthly] = useState('');
  const [mortgageLoanAmount, setMortgageLoanAmount] = useState('');
  const [mortgageStartDate, setMortgageStartDate] = useState('');
  const [mortgageTermYears, setMortgageTermYears] = useState('');
  const [mortgageInterestRate, setMortgageInterestRate] = useState('');
  const [debtOriginalAmount, setDebtOriginalAmount] = useState('');
  const [alreadyPaid, setAlreadyPaid] = useState('');

  const [debtSubtype, setDebtSubtype] = useState<'regular' | 'mortgage'>('regular');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadValue, setNumpadValue] = useState('');
  const [showCurrencyWarn, setShowCurrencyWarn] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset form on open
  useEffect(() => {
    if (!isOpen) {
      setIsSaving(false);
      setSaveError(null);
      return;
    }
    setErrors({});
    setShowNumpad(false);
    setNumpadValue('');
    if (editAccount) {
      setName(editAccount.name);
      setType(editAccount.type);
      setColor(editAccount.color);
      setIcon(editAccount.icon);
      setCurrency(editAccount.currency);
      setDescription(editAccount.description);
      setStartingBalance(String(editAccount.startingBalance));
      setIncludeInTotal(editAccount.includeInTotal);
      setSavingsGoal(editAccount.savingsGoal != null ? String(editAccount.savingsGoal) : '');
      setInterestRateYearly(editAccount.interestRateYearly != null ? String(editAccount.interestRateYearly * 100) : '');
      setInterestRateMonthly(editAccount.interestRateMonthly != null ? String(editAccount.interestRateMonthly * 100) : '');
      setMortgageLoanAmount(editAccount.mortgageLoanAmount != null ? String(editAccount.mortgageLoanAmount) : '');
      setMortgageStartDate(editAccount.mortgageStartDate ?? '');
      setMortgageTermYears(editAccount.mortgageTermYears != null ? String(editAccount.mortgageTermYears) : '');
      setMortgageInterestRate(editAccount.mortgageInterestRate != null ? String(editAccount.mortgageInterestRate * 100) : '');
      setDebtOriginalAmount(editAccount.debtOriginalAmount != null ? String(editAccount.debtOriginalAmount) : '');
      setAlreadyPaid('');
      const isMortgage =
        editAccount.mortgageLoanAmount != null ||
        editAccount.mortgageStartDate != null ||
        editAccount.mortgageTermYears != null ||
        editAccount.mortgageInterestRate != null;
      setDebtSubtype(isMortgage ? 'mortgage' : 'regular');
    } else {
      setName('');
      setType('REGULAR');
      setColor(DEFAULT_COLOR);
      setIcon(DEFAULT_ICON);
      setCurrency(mainCurrency);
      setDescription('');
      setStartingBalance('');
      setIncludeInTotal(true);
      setSavingsGoal('');
      setInterestRateYearly('');
      setInterestRateMonthly('');
      setMortgageLoanAmount('');
      setMortgageStartDate('');
      setMortgageTermYears('');
      setMortgageInterestRate('');
      setDebtOriginalAmount('');
      setAlreadyPaid('');
      setDebtSubtype('regular');
    }
  }, [isOpen, editAccount, mainCurrency]);

  const handleCurrencyChange = (c: string) => {
    if (isEdit && c !== currency) {
      setPendingCurrency(c);
      setShowCurrencyWarn(true);
    } else {
      setCurrency(c);
    }
  };

  const confirmCurrencyChange = () => {
    if (pendingCurrency) setCurrency(pendingCurrency);
    setPendingCurrency(null);
    setShowCurrencyWarn(false);
  };

  const cancelCurrencyChange = () => {
    setPendingCurrency(null);
    setShowCurrencyWarn(false);
  };

  const handleDebtSubtypeChange = (sub: 'regular' | 'mortgage') => {
    if (sub === debtSubtype) return;
    setDebtSubtype(sub);
    setErrors({});
    if (sub === 'regular') {
      setMortgageLoanAmount('');
      setMortgageStartDate('');
      setMortgageTermYears('');
      setMortgageInterestRate('');
    } else {
      setInterestRateYearly('');
      setInterestRateMonthly('');
    }
  };

  const recalcStartingBalance = (original: string, paid: string) => {
    const o = parseFloat(original);
    const p = parseFloat(paid);
    if (!isNaN(o) && o > 0 && !isNaN(p) && p >= 0) {
      setStartingBalance(String(Math.max(0, o - p)));
    }
  };

  const handleOriginalAmountChange = (value: string) => {
    setDebtOriginalAmount(value);
    recalcStartingBalance(value, alreadyPaid);
  };

  const handleAlreadyPaidChange = (value: string) => {
    setAlreadyPaid(value);
    recalcStartingBalance(debtOriginalAmount, value);
  };

  const validate = () => {
    const raw = {
      name: name.trim(),
      type,
      color,
      icon,
      currency,
      description: description.trim(),
      startingBalance: parseFloat(startingBalance) || 0,
      includeInTotal,
      savingsGoal: type === 'SAVINGS' && savingsGoal ? parseFloat(savingsGoal) : null,
      interestRateMonthly: type === 'DEBT' && debtSubtype === 'regular' && interestRateMonthly ? parseFloat(interestRateMonthly) / 100 : null,
      interestRateYearly: type === 'DEBT' && debtSubtype === 'regular' && interestRateYearly ? parseFloat(interestRateYearly) / 100 : null,
      mortgageLoanAmount: type === 'DEBT' && debtSubtype === 'mortgage' && mortgageLoanAmount ? parseFloat(mortgageLoanAmount) : null,
      mortgageStartDate: type === 'DEBT' && debtSubtype === 'mortgage' ? (mortgageStartDate || null) : null,
      mortgageTermYears: type === 'DEBT' && debtSubtype === 'mortgage' && mortgageTermYears ? parseInt(mortgageTermYears) : null,
      mortgageInterestRate: type === 'DEBT' && debtSubtype === 'mortgage' && mortgageInterestRate ? parseFloat(mortgageInterestRate) / 100 : null,
      debtOriginalAmount: type === 'DEBT' && debtOriginalAmount ? parseFloat(debtOriginalAmount) : null,
    };
    const result = accountSchema.safeParse(raw);
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        errs[field] = issue.message;
      }
      setErrors(errs);
      return null;
    }

    if (type === 'DEBT' && debtSubtype === 'regular') {
      const hasYearly = !!interestRateYearly;
      const hasMonthly = !!interestRateMonthly;
      if (hasYearly && hasMonthly) {
        setErrors({ interestRateYearly: 'Enter yearly or monthly rate — not both' });
        return null;
      }
      if (!hasYearly && !hasMonthly) {
        setErrors({ interestRateYearly: 'Enter a yearly or monthly interest rate' });
        return null;
      }
    }

    setErrors({});
    return raw;
  };

  const handleSave = async () => {
    const data = validate();
    if (!data) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      if (isEdit && editAccount?.id != null) {
        await db.accounts.update(editAccount.id, {
          name: data.name,
          type: data.type,
          color: data.color,
          icon: data.icon,
          currency: data.currency,
          description: data.description,
          includeInTotal: data.includeInTotal,
          savingsGoal: data.savingsGoal ?? null,
          interestRateMonthly: data.interestRateMonthly ?? null,
          interestRateYearly: data.interestRateYearly ?? null,
          mortgageLoanAmount: data.mortgageLoanAmount ?? null,
          mortgageStartDate: data.mortgageStartDate ?? null,
          mortgageTermYears: data.mortgageTermYears ?? null,
          mortgageInterestRate: data.mortgageInterestRate ?? null,
          debtOriginalAmount: data.debtOriginalAmount ?? null,
          updatedAt: now,
        });
      } else {
        const sb = parseFloat(startingBalance) || 0;
        await db.accounts.add({
          name: data.name,
          type: data.type,
          color: data.color,
          icon: data.icon,
          currency: data.currency,
          description: data.description,
          balance: sb,
          startingBalance: sb,
          includeInTotal: data.includeInTotal,
          isTrashed: false,
          savingsGoal: data.savingsGoal ?? null,
          savingsInterestRate: null,
          interestRateMonthly: data.interestRateMonthly ?? null,
          interestRateYearly: data.interestRateYearly ?? null,
          mortgageLoanAmount: data.mortgageLoanAmount ?? null,
          mortgageStartDate: data.mortgageStartDate ?? null,
          mortgageTermYears: data.mortgageTermYears ?? null,
          mortgageInterestRate: data.mortgageInterestRate ?? null,
          debtOriginalAmount: data.debtOriginalAmount ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
      onClose();
    } catch (err) {
      console.error('Failed to save account:', err);
      setSaveError('Failed to save. Storage may be full.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    minHeight: '44px',
    padding: '0 var(--space-3)',
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-input)',
    color: 'var(--color-text)',
    fontSize: 'var(--text-body)',
    fontFamily: '"DM Sans", sans-serif',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: '"DM Sans", sans-serif',
    fontWeight: 500,
    fontSize: 'var(--text-caption)',
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 'var(--space-1)',
    display: 'block',
  };

  const sectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  };

  const errorStyle: React.CSSProperties = {
    fontFamily: '"DM Sans", sans-serif',
    fontSize: 'var(--text-caption)',
    color: 'var(--color-expense)',
    marginTop: '2px',
  };

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? 'Edit Account' : 'New Account'}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            padding: '0 var(--space-4) var(--space-8)',
          }}
        >
          <>
              {/* Account type */}
              <div style={sectionStyle}>
                <span style={labelStyle}>Type</span>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  {(['REGULAR', 'DEBT', 'SAVINGS'] as AccountType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => !isEdit && setType(t)}
                      style={{
                        flex: 1,
                        minHeight: '44px',
                        borderRadius: 'var(--radius-btn)',
                        background: type === t ? 'var(--color-primary-dim)' : 'var(--color-surface-raised)',
                        color: type === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        border: type === t ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                        cursor: isEdit ? 'default' : 'pointer',
                        fontFamily: '"DM Sans", sans-serif',
                        fontWeight: 500,
                        fontSize: 'var(--text-caption)',
                        opacity: isEdit ? (type === t ? 0.85 : 0.4) : 1,
                        transition: 'all 100ms ease-out',
                        position: 'relative',
                      }}
                    >
                      {t === 'REGULAR' ? 'Regular' : t === 'DEBT' ? 'Debt' : 'Savings'}
                      {isEdit && type === t && (
                        <Lock
                          size={14}
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            color: 'var(--color-text-disabled)',
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
                {isEdit && (
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 'var(--text-caption)',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    Account type cannot be changed after creation
                  </span>
                )}
              </div>

              {/* Name */}
              <div style={sectionStyle}>
                <label htmlFor="acc-name" style={labelStyle}>Name</label>
                <input
                  id="acc-name"
                  type="text"
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Account name"
                  style={{
                    ...inputStyle,
                    borderColor: errors.name ? 'var(--color-expense)' : 'var(--color-border)',
                  }}
                />
                {errors.name && <span style={errorStyle}>{errors.name}</span>}
              </div>

              {/* Currency */}
              <div style={sectionStyle}>
                <span style={labelStyle}>Currency</span>
                <CurrencyPicker value={currency} onChange={handleCurrencyChange} />
              </div>

              {/* Color */}
              <div style={sectionStyle}>
                <span style={labelStyle}>Color</span>
                <ColorPicker value={color} onChange={setColor} />
              </div>

              {/* Icon */}
              <div style={sectionStyle}>
                <span style={labelStyle}>Icon</span>
                <IconPicker value={icon} onChange={setIcon} />
              </div>

              {/* Starting balance (new only) */}
              {!isEdit && (
                <div style={sectionStyle}>
                  <span style={labelStyle}>Starting Balance</span>
                  <button
                    onClick={() => setShowNumpad(true)}
                    style={{
                      ...inputStyle,
                      textAlign: 'left',
                      cursor: 'pointer',
                      background: 'var(--color-surface-raised)',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 500,
                    }}
                  >
                    {startingBalance || '0.00'}
                  </button>
                </div>
              )}

              {/* Include in total */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: '44px',
                }}
              >
                <span
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: 'var(--text-body)',
                    color: 'var(--color-text)',
                  }}
                >
                  Include in total
                </span>
                <button
                  role="switch"
                  aria-checked={includeInTotal}
                  onClick={() => setIncludeInTotal(!includeInTotal)}
                  style={{
                    width: '44px',
                    height: '26px',
                    borderRadius: '9999px',
                    background: includeInTotal ? 'var(--color-primary)' : 'var(--color-border-strong)',
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'background 150ms ease-out',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '3px',
                      left: includeInTotal ? '21px' : '3px',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: 'white',
                      transition: 'left 150ms ease-out',
                    }}
                  />
                </button>
              </div>

              {/* Savings-specific */}
              {type === 'SAVINGS' && (
                <div style={sectionStyle}>
                  <label htmlFor="savings-goal" style={labelStyle}>Savings Goal (optional)</label>
                  <input
                    id="savings-goal"
                    type="number"
                    value={savingsGoal}
                    min="0"
                    onChange={(e) => setSavingsGoal(e.target.value)}
                    placeholder="e.g. 10000"
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Debt-specific */}
              {type === 'DEBT' && (
                <>
                  {/* Original amount for progress bar */}
                  <div style={sectionStyle}>
                    <label htmlFor="debt-original" style={labelStyle}>Original Amount (optional)</label>
                    <input
                      id="debt-original"
                      type="number"
                      value={debtOriginalAmount}
                      min="0"
                      onChange={(e) => handleOriginalAmountChange(e.target.value)}
                      placeholder="e.g. 50000"
                      style={inputStyle}
                    />
                    <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', color: 'var(--color-text-disabled)' }}>
                      Set to show a payoff progress bar
                    </span>
                  </div>

                  {/* Already Paid helper — create only, shown when original amount is set */}
                  {!isEdit && debtOriginalAmount && (
                    <div style={sectionStyle}>
                      <label htmlFor="debt-already-paid" style={labelStyle}>Already Paid</label>
                      <input
                        id="debt-already-paid"
                        type="number"
                        value={alreadyPaid}
                        min="0"
                        onChange={(e) => handleAlreadyPaidChange(e.target.value)}
                        placeholder="0"
                        style={inputStyle}
                      />
                      <span style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 'var(--text-caption)', color: 'var(--color-text-disabled)' }}>
                        Auto-fills starting balance as: original − already paid
                      </span>
                    </div>
                  )}

                  {/* Debt subtype toggle */}
                  <div style={sectionStyle}>
                    <span style={labelStyle}>Debt Type</span>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {(['regular', 'mortgage'] as const).map((sub) => (
                        <button
                          key={sub}
                          onClick={() => handleDebtSubtypeChange(sub)}
                          style={{
                            flex: 1,
                            minHeight: '44px',
                            borderRadius: 'var(--radius-btn)',
                            background: debtSubtype === sub ? 'var(--color-primary-dim)' : 'var(--color-surface-raised)',
                            color: debtSubtype === sub ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            border: debtSubtype === sub ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                            cursor: 'pointer',
                            fontFamily: '"DM Sans", sans-serif',
                            fontWeight: 500,
                            fontSize: 'var(--text-caption)',
                            transition: 'all 100ms ease-out',
                          }}
                        >
                          {sub === 'regular' ? 'Regular Debt' : 'Mortgage'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Regular debt fields */}
                  {debtSubtype === 'regular' && (
                    <>
                      <span
                        style={{
                          fontFamily: '"DM Sans", sans-serif',
                          fontSize: 'var(--text-caption)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        Enter yearly OR monthly interest rate — at least one is required, not both
                      </span>
                      <div style={sectionStyle}>
                        <label htmlFor="interest-yearly" style={labelStyle}>Yearly Interest Rate (%)</label>
                        <input
                          id="interest-yearly"
                          type="number"
                          value={interestRateYearly}
                          min="0"
                          max="100"
                          step="0.01"
                          onChange={(e) => setInterestRateYearly(e.target.value)}
                          placeholder="e.g. 5.5"
                          style={{
                            ...inputStyle,
                            borderColor: errors.interestRateYearly ? 'var(--color-expense)' : 'var(--color-border)',
                          }}
                        />
                        {errors.interestRateYearly && <span style={errorStyle}>{errors.interestRateYearly}</span>}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                        }}
                      >
                        <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
                        <span
                          style={{
                            fontFamily: '"DM Sans", sans-serif',
                            fontSize: 'var(--text-caption)',
                            color: 'var(--color-text-disabled)',
                            fontWeight: 500,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          or
                        </span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
                      </div>
                      <div style={sectionStyle}>
                        <label htmlFor="interest-monthly" style={labelStyle}>Monthly Interest Rate (%)</label>
                        <input
                          id="interest-monthly"
                          type="number"
                          value={interestRateMonthly}
                          min="0"
                          max="100"
                          step="0.001"
                          onChange={(e) => setInterestRateMonthly(e.target.value)}
                          placeholder="e.g. 0.45"
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}

                  {/* Mortgage fields */}
                  {debtSubtype === 'mortgage' && (
                    <>
                      <div style={sectionStyle}>
                        <label htmlFor="mortgage-amount" style={labelStyle}>Loan Amount</label>
                        <input
                          id="mortgage-amount"
                          type="number"
                          value={mortgageLoanAmount}
                          min="0"
                          onChange={(e) => setMortgageLoanAmount(e.target.value)}
                          placeholder="e.g. 250000"
                          style={inputStyle}
                        />
                      </div>
                      <div style={sectionStyle}>
                        <label htmlFor="mortgage-start" style={labelStyle}>Start Date</label>
                        <input
                          id="mortgage-start"
                          type="date"
                          value={mortgageStartDate}
                          onChange={(e) => setMortgageStartDate(e.target.value)}
                          style={{ ...inputStyle, colorScheme: 'dark' }}
                        />
                      </div>
                      <div style={sectionStyle}>
                        <label htmlFor="mortgage-term" style={labelStyle}>Term (years)</label>
                        <input
                          id="mortgage-term"
                          type="number"
                          value={mortgageTermYears}
                          min="1"
                          max="50"
                          step="1"
                          onChange={(e) => setMortgageTermYears(e.target.value)}
                          placeholder="e.g. 25"
                          style={inputStyle}
                        />
                      </div>
                      <div style={sectionStyle}>
                        <label htmlFor="mortgage-rate" style={labelStyle}>Annual Interest Rate (%)</label>
                        <input
                          id="mortgage-rate"
                          type="number"
                          value={mortgageInterestRate}
                          min="0"
                          max="100"
                          step="0.01"
                          onChange={(e) => setMortgageInterestRate(e.target.value)}
                          placeholder="e.g. 3.25"
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Description */}
              <div style={sectionStyle}>
                <label htmlFor="acc-desc" style={labelStyle}>Description</label>
                <textarea
                  id="acc-desc"
                  value={description}
                  maxLength={255}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  style={{
                    ...inputStyle,
                    minHeight: '80px',
                    padding: 'var(--space-2) var(--space-3)',
                    resize: 'vertical',
                  }}
                />
              </div>
          </>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              minHeight: '52px',
              background: 'var(--color-primary)',
              color: 'var(--color-bg)',
              border: 'none',
              borderRadius: 'var(--radius-btn)',
              fontFamily: 'Syne, sans-serif',
              fontWeight: 700,
              fontSize: 'var(--text-body)',
              letterSpacing: '0.05em',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
              boxShadow: '0 4px 16px oklch(72% 0.22 210 / 30%)',
              transition: 'opacity 100ms ease-out',
            }}
          >
            {isSaving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Account'}
          </button>
          {saveError && (
            <span style={errorStyle}>{saveError}</span>
          )}
        </div>

        {/* Numpad overlay for starting balance */}
        {showNumpad && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--color-surface-raised)',
              borderRadius: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10,
            }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-4)',
                gap: 'var(--space-2)',
              }}
            >
              <span style={labelStyle}>Starting Balance ({currency})</span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-amount-lg)',
                  color: 'var(--color-text)',
                }}
              >
                {numpadValue || '0'}
              </span>
            </div>
            <Numpad
              value={numpadValue}
              onChange={setNumpadValue}
              onSave={(v) => {
                setStartingBalance(String(v));
                setNumpadValue('');
                setShowNumpad(false);
              }}
              variant="budget"
            />
          </div>
        )}
      </BottomSheet>

      {/* Currency change warning */}
      <ConfirmDialog
        isOpen={showCurrencyWarn}
        title="Change Currency?"
        body="Changing the currency will not convert existing transactions. The balance display will use the new currency code."
        confirmLabel="Change Currency"
        onConfirm={confirmCurrencyChange}
        onCancel={cancelCurrencyChange}
        variant="destructive"
      />
    </>
  );
}
