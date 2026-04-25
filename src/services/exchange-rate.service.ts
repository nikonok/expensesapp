import { db } from "../db/database";
import { getLocalDateString, getUTCISOString } from "../utils/date-utils";
import { logger } from "./log.service";

const API_BASE = "https://open.er-api.com/v6/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PRUNE_DAYS = 90;

async function getMainCurrency(): Promise<string> {
  const setting = await db.settings.get("mainCurrency");
  return (setting?.value as string) ?? "USD";
}

function deriveRate(
  rates: Record<string, number>,
  from: string,
  to: string,
  base: string,
): number | null {
  if (from === to) return 1;

  if (from === base) {
    // 1 base = rates[to] to-units
    const r = rates[to];
    return r != null ? r : null;
  }

  if (to === base) {
    // 1 from = ? base-units → rates[from] gives 1 base = rates[from] from-units
    // so 1 from = 1/rates[from] base-units
    const r = rates[from];
    return r != null && r !== 0 ? 1 / r : null;
  }

  // Cross-rate: neither currency is base
  // rates[from] = how many from per 1 base
  // rates[to]   = how many to   per 1 base
  // 1 from = rates[to] / rates[from] to-units
  const rFrom = rates[from];
  const rTo = rates[to];
  if (rFrom != null && rTo != null && rFrom !== 0) {
    return rTo / rFrom;
  }
  return null;
}

export const exchangeRateService = {
  async fetchAndCacheRates(baseCurrency: string): Promise<void> {
    try {
      if (!/^[A-Z]{3}$/.test(baseCurrency)) {
        throw new Error(`Invalid currency code: ${baseCurrency}`);
      }
      const response = await fetch(`${API_BASE}/${baseCurrency}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch exchange rates: ${response.status}`);
      }
      const json = (await response.json()) as { rates?: Record<string, number> };
      if (!json.rates) {
        throw new Error("Invalid exchange rate API response: missing rates");
      }

      const rawRates = json.rates;
      const rates: Record<string, number> = {};
      for (const [k, v] of Object.entries(rawRates)) {
        if (typeof v === "number" && isFinite(v) && v > 0) {
          rates[k] = v;
        }
      }

      const today = getLocalDateString();
      const now = getUTCISOString();

      // Upsert using the unique index [baseCurrency+date]
      const existing = await db.exchangeRates
        .where("[baseCurrency+date]")
        .equals([baseCurrency, today])
        .first();

      if (existing?.id != null) {
        await db.exchangeRates.update(existing.id, {
          rates,
          fetchedAt: now,
        });
      } else {
        await db.exchangeRates.add({
          baseCurrency,
          date: today,
          rates,
          fetchedAt: now,
        });
      }

      // Prune entries older than 90 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      await db.exchangeRates.where("date").below(cutoffDate).delete();
      logger.info("exchangeRate.fetch.ok", { baseCurrency });
    } catch (err) {
      logger.error("exchangeRate.fetch.failed", {
        baseCurrency,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  async getRate(from: string, to: string): Promise<number | null> {
    if (from === to) return 1;

    const base = await getMainCurrency();
    const today = getLocalDateString();

    // Try today's cache entry
    let entry = await db.exchangeRates.where("[baseCurrency+date]").equals([base, today]).first();

    if (entry) {
      const age = Date.now() - new Date(entry.fetchedAt).getTime();
      if (age > CACHE_TTL_MS) {
        // Stale — try to refresh
        try {
          await exchangeRateService.fetchAndCacheRates(base);
          entry = await db.exchangeRates.where("[baseCurrency+date]").equals([base, today]).first();
        } catch {
          // Fetch failed — fall through to use stale entry already loaded
        }
      }
    } else {
      // Cache miss — try to fetch
      try {
        await exchangeRateService.fetchAndCacheRates(base);
        entry = await db.exchangeRates.where("[baseCurrency+date]").equals([base, today]).first();
      } catch {
        // Fetch failed — try to find any cached entry for this base
        entry = await db.exchangeRates.where("baseCurrency").equals(base).last();
      }
    }

    if (!entry) return null;
    const rate = deriveRate(entry.rates, from, to, base);
    if (rate != null && (!isFinite(rate) || rate <= 0)) return null;
    return rate;
  },

  async getHistoricalRate(from: string, to: string, date: string): Promise<number | null> {
    if (from === to) return 1;

    const base = await getMainCurrency();

    // Find most recent cached entry with date <= requested date
    const entry = await db.exchangeRates
      .where("[baseCurrency+date]")
      .between([base, ""], [base, date], true, true)
      .last();

    if (!entry) return null;
    const historicalRate = deriveRate(entry.rates, from, to, base);
    if (historicalRate != null && (!isFinite(historicalRate) || historicalRate <= 0)) return null;
    return historicalRate;
  },

  async recalculateAllMainCurrencyAmounts(
    newMainCurrency: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    try {
      // Fetch fresh rates for the new main currency first
      await exchangeRateService.fetchAndCacheRates(newMainCurrency);

      const transactions = await db.transactions.toArray();
      const total = transactions.length;

      logger.info("exchangeRate.recalc.start", { newMainCurrency, total });

      if (total === 0) {
        onProgress?.(0, 0);
        logger.info("exchangeRate.recalc.complete", { newMainCurrency, total: 0 });
        return;
      }

      // Collect unique (currency, date) pairs needed for the rate lookup
      const pairs = new Map<string, string[]>(); // currency -> unique dates
      for (const tx of transactions) {
        if (tx.currency === newMainCurrency) continue;
        if (!pairs.has(tx.currency)) pairs.set(tx.currency, []);
        pairs.get(tx.currency)!.push(tx.date);
      }

      // Pre-fetch all required rates OUTSIDE of any db transaction
      // Key: "currency:date", Value: rate (number)
      const rateMap = new Map<string, number>();
      const missingCurrencies: string[] = [];

      for (const [currency, dates] of pairs) {
        const uniqueDates = [...new Set(dates)];
        let hasMissing = false;
        for (const date of uniqueDates) {
          const rate = await exchangeRateService.getHistoricalRate(currency, newMainCurrency, date);
          if (rate == null) {
            hasMissing = true;
          } else {
            rateMap.set(`${currency}:${date}`, rate);
          }
        }
        if (hasMissing && !missingCurrencies.includes(currency)) {
          missingCurrencies.push(currency);
        }
      }

      if (missingCurrencies.length > 0) {
        throw new Error(`No exchange rate available for: ${missingCurrencies.join(", ")}`);
      }

      // Now open the db transaction — only db.transactions is accessed here,
      // and we use only the pre-built rateMap (no db.exchangeRates reads inside).
      const BATCH_SIZE = 50;
      let done = 0;

      await db.transaction("rw", db.transactions, async () => {
        for (let i = 0; i < total; i += BATCH_SIZE) {
          const batch = transactions.slice(i, i + BATCH_SIZE);

          for (const tx of batch) {
            let newRate: number;
            if (tx.currency === newMainCurrency) {
              newRate = 1;
            } else {
              // Rate is guaranteed to be in the map (verified above)
              newRate = rateMap.get(`${tx.currency}:${tx.date}`)!;
            }

            await db.transactions.update(tx.id!, {
              exchangeRate: newRate,
              amountMainCurrency: Math.round(tx.amount * newRate),
            });

            done++;
          }

          onProgress?.(done, total);
        }
      });
      logger.info("exchangeRate.recalc.complete", { newMainCurrency });
    } catch (err) {
      logger.error("exchangeRate.recalc.failed", {
        newMainCurrency,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
};
