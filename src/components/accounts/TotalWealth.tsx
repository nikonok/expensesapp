import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../db/database';
import { exchangeRateService } from '../../services/exchange-rate.service';
import { useSettingsStore } from '../../stores/settings-store';

interface CurrencyGroup {
  currency: string;
  assets: number;
  debts: number;
}

function cellFontSize(str: string): string {
  if (str.length > 13) return 'var(--text-caption)';
  if (str.length > 10) return 'var(--text-amount-sm)';
  return 'var(--text-body)';
}

export default function TotalWealth() {
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.isTrashed).toArray(),
    [],
  ) ?? [];

  const [grandAssets, setGrandAssets] = useState<number | null>(null);
  const [grandDebts, setGrandDebts] = useState<number | null>(null);

  // Group active accounts by currency
  const groups = useMemo(() => {
    const result: CurrencyGroup[] = [];
    const grouped: Record<string, CurrencyGroup> = {};
    for (const acc of accounts) {
      if (!acc.includeInTotal) continue;
      if (!grouped[acc.currency]) {
        grouped[acc.currency] = { currency: acc.currency, assets: 0, debts: 0 };
        result.push(grouped[acc.currency]);
      }
      if (acc.type === 'DEBT') {
        grouped[acc.currency].debts += Math.abs(acc.balance);
      } else {
        grouped[acc.currency].assets += acc.balance;
      }
    }
    return result;
  }, [accounts]);

  // Convert to main currency for grand total
  useEffect(() => {
    let cancelled = false;
    async function calc() {
      const currencies = [...new Set(groups.map((g) => g.currency))];
      const rates = await Promise.all(currencies.map((c) => exchangeRateService.getRate(c, mainCurrency)));
      const rateMap = Object.fromEntries(currencies.map((c, i) => [c, rates[i]]));

      let totalAssets = 0;
      let totalDebts = 0;
      for (const g of groups) {
        const r = g.currency === mainCurrency ? 1 : (rateMap[g.currency] ?? 1);
        totalAssets += g.assets * r;
        totalDebts += g.debts * r;
      }
      if (!cancelled) {
        setGrandAssets(totalAssets);
        setGrandDebts(totalDebts);
      }
    }
    calc();
    return () => { cancelled = true; };
  }, [groups, mainCurrency]);

  if (groups.length === 0) return null;

  const formatAmount = (amount: number, currency: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount));

  const netWorth = grandAssets != null && grandDebts != null
    ? grandAssets - grandDebts
    : null;

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        marginBottom: 'var(--space-4)',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
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
          Currency
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-caption)',
            color: 'var(--color-income)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            textAlign: 'right',
          }}
        >
          Assets
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-caption)',
            color: 'var(--color-expense)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            textAlign: 'right',
          }}
        >
          Debts
        </span>
      </div>

      {/* Currency rows */}
      {groups.map((g) => {
        const assetsStr = formatAmount(g.assets, g.currency);
        const debtsStr = formatAmount(g.debts, g.currency);
        return (
          <div
            key={g.currency}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              padding: 'var(--space-2) var(--space-4)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: 'var(--text-body)',
                color: 'var(--color-text)',
              }}
            >
              {g.currency}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: cellFontSize(assetsStr),
                color: g.assets < 0 ? 'var(--color-expense)' : g.assets > 0 ? 'var(--color-income)' : 'var(--color-text-secondary)',
                textAlign: 'right',
              }}
            >
              {g.assets < 0 ? '\u2212' : ''}{assetsStr}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: g.debts > 0 ? cellFontSize(debtsStr) : 'var(--text-body)',
                color: g.debts > 0 ? 'var(--color-expense)' : 'var(--color-text-secondary)',
                textAlign: 'right',
              }}
            >
              {g.debts > 0 ? debtsStr : '—'}
            </span>
          </div>
        );
      })}

      {/* Grand total row */}
      {grandAssets != null && grandDebts != null && (
        <div
          role="status"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-surface-raised)',
          }}
        >
          <span
            style={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 700,
              fontSize: 'var(--text-body)',
              color: 'var(--color-text)',
            } as React.CSSProperties}
          >
            Net
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: cellFontSize(formatAmount(grandAssets, mainCurrency)),
              color: grandAssets < 0 ? 'var(--color-expense)' : grandAssets > 0 ? 'var(--color-income)' : 'var(--color-text-secondary)',
              textAlign: 'right',
            }}
          >
            {grandAssets < 0 ? '\u2212' : ''}{formatAmount(grandAssets, mainCurrency)}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: netWorth != null ? cellFontSize(formatAmount(netWorth, mainCurrency)) : 'var(--text-body)',
              color: netWorth != null && netWorth >= 0 ? 'var(--color-income)' : 'var(--color-expense)',
              textAlign: 'right',
            }}
          >
            {netWorth != null ? (netWorth < 0 ? '\u2212' : '') + formatAmount(netWorth, mainCurrency) : '…'}
          </span>
        </div>
      )}
    </div>
  );
}
