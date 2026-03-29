import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../../db/database';
import type { Account } from '../../db/models';
import { exchangeRateService } from '../../services/exchange-rate.service';
import { useSettingsStore } from '../../stores/settings-store';

interface CurrencyGroup {
  currency: string;
  assets: number;
  debts: number;
}

export default function TotalWealth() {
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  const accounts = useLiveQuery(
    () => db.accounts.where('isTrashed').equals(0).toArray(),
    [],
  ) ?? [];

  const [grandAssets, setGrandAssets] = useState<number | null>(null);
  const [grandDebts, setGrandDebts] = useState<number | null>(null);

  // Group active accounts by currency
  const groups: CurrencyGroup[] = [];
  const grouped: Record<string, CurrencyGroup> = {};

  for (const acc of accounts) {
    if (!acc.includeInTotal) continue;
    if (!grouped[acc.currency]) {
      grouped[acc.currency] = { currency: acc.currency, assets: 0, debts: 0 };
      groups.push(grouped[acc.currency]);
    }
    if (acc.type === 'DEBT') {
      grouped[acc.currency].debts += Math.abs(acc.balance);
    } else {
      grouped[acc.currency].assets += acc.balance;
    }
  }

  // Convert to main currency for grand total
  useEffect(() => {
    let cancelled = false;
    async function calc() {
      let totalAssets = 0;
      let totalDebts = 0;
      for (const g of groups) {
        if (g.currency === mainCurrency) {
          totalAssets += g.assets;
          totalDebts += g.debts;
        } else {
          const rate = await exchangeRateService.getRate(g.currency, mainCurrency);
          const r = rate ?? 1;
          totalAssets += g.assets * r;
          totalDebts += g.debts * r;
        }
      }
      if (!cancelled) {
        setGrandAssets(totalAssets);
        setGrandDebts(totalDebts);
      }
    }
    calc();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, mainCurrency]);

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
      {groups.map((g) => (
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
              fontSize: 'var(--text-body)',
              color: g.assets > 0 ? 'var(--color-income)' : 'var(--color-text-secondary)',
              textAlign: 'right',
            }}
          >
            {formatAmount(g.assets, g.currency)}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              color: g.debts > 0 ? 'var(--color-expense)' : 'var(--color-text-secondary)',
              textAlign: 'right',
            }}
          >
            {g.debts > 0 ? formatAmount(g.debts, g.currency) : '—'}
          </span>
        </div>
      ))}

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
              fontSize: 'var(--text-body)',
              color: 'var(--color-income)',
              textAlign: 'right',
            }}
          >
            {formatAmount(grandAssets, mainCurrency)}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: 'var(--text-body)',
              color: netWorth != null && netWorth >= 0 ? 'var(--color-income)' : 'var(--color-expense)',
              textAlign: 'right',
            }}
          >
            {netWorth != null ? formatAmount(netWorth, mainCurrency) : '…'}
          </span>
        </div>
      )}
    </div>
  );
}
