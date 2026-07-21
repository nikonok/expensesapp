import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db } from "../db/database";
import { exchangeRateService } from "../services/exchange-rate.service";
import { useSettingsStore } from "../stores/settings-store";

export interface CurrencyGroup {
  currency: string;
  assets: number;
  debts: number;
}

export function useTotalBalance(): {
  netWorth: number | null;
  mainCurrency: string;
  ratesAvailable: boolean;
  groups: CurrencyGroup[];
  grandAssets: number | null;
  grandDebts: number | null;
} {
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);

  const accounts = useLiveQuery(() => db.accounts.filter((a) => !a.isTrashed).toArray(), []) ?? [];

  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [grandAssets, setGrandAssets] = useState<number | null>(null);
  const [grandDebts, setGrandDebts] = useState<number | null>(null);
  const [ratesAvailable, setRatesAvailable] = useState(true);

  const groups = useMemo(() => {
    const result: CurrencyGroup[] = [];
    const grouped: Record<string, CurrencyGroup> = {};
    for (const acc of accounts) {
      if (!acc.includeInTotal) continue;
      if (!grouped[acc.currency]) {
        grouped[acc.currency] = { currency: acc.currency, assets: 0, debts: 0 };
        result.push(grouped[acc.currency]);
      }
      if (acc.type === "DEBT") {
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
      setGrandAssets(null);
      setGrandDebts(null);
      return;
    }
    let cancelled = false;
    async function calc() {
      // Reset unavailability at the start of each recalculation so a successful
      // reload clears any previously flagged missing rate.
      if (!cancelled) setRatesAvailable(true);
      const currencies = [...new Set(groups.map((g) => g.currency))];
      const rates = await Promise.all(
        currencies.map((c) => exchangeRateService.getRate(c, mainCurrency)),
      );
      const rateMap = Object.fromEntries(currencies.map((c, i) => [c, rates[i]]));
      let totalAssets = 0;
      let totalDebts = 0;
      for (const g of groups) {
        if (g.currency === mainCurrency) {
          totalAssets += g.assets;
          totalDebts += g.debts;
        } else {
          const r = rateMap[g.currency];
          // null means the rate service had no data — propagate unknown rather than show a wrong total
          if (r == null) {
            if (!cancelled) {
              setRatesAvailable(false);
              setNetWorth(null);
              setGrandAssets(null);
              setGrandDebts(null);
            }
            return;
          }
          // Round each converted leg to integer minor units before summing.
          // Summing raw floats produces sub-cent drift across many accounts
          // (the displayed total can otherwise disagree with the per-account
          // sum by a few minor units after enough currencies are involved).
          totalAssets += Math.round(g.assets * r);
          totalDebts += Math.round(g.debts * r);
        }
      }
      if (!cancelled) {
        setNetWorth(totalAssets - totalDebts);
        setGrandAssets(totalAssets);
        setGrandDebts(totalDebts);
      }
    }
    void calc();
    return () => {
      cancelled = true;
    };
  }, [groups, mainCurrency]);

  return { netWorth, mainCurrency, ratesAvailable, groups, grandAssets, grandDebts };
}
