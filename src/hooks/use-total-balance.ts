import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/database';
import { exchangeRateService } from '../services/exchange-rate.service';
import { useSettingsStore } from '../stores/settings-store';

export function useTotalBalance(): { netWorth: number | null; mainCurrency: string } {
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.isTrashed).toArray(),
    [],
  ) ?? [];

  const [netWorth, setNetWorth] = useState<number | null>(null);

  const groups = useMemo(() => {
    const result: { currency: string; assets: number; debts: number }[] = [];
    const grouped: Record<string, { currency: string; assets: number; debts: number }> = {};
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

  useEffect(() => {
    if (groups.length === 0) {
      setNetWorth(null);
      return;
    }
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
      if (!cancelled) setNetWorth(totalAssets - totalDebts);
    }
    void calc();
    return () => { cancelled = true; };
  }, [groups, mainCurrency]);

  return { netWorth, mainCurrency };
}
