import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock the db module before importing the service
const mockSettings = new Map<string, unknown>();
const mockExchangeRates: Array<{
  id?: number;
  baseCurrency: string;
  date: string;
  rates: Record<string, number>;
  fetchedAt: string;
}> = [];
let nextId = 1;

// Helper to build a Dexie-like chainable query
function makeQuery(results: typeof mockExchangeRates) {
  return {
    first: () => Promise.resolve(results[0] ?? undefined),
    last: () => Promise.resolve(results[results.length - 1] ?? undefined),
    delete: () => {
      for (const r of results) {
        const idx = mockExchangeRates.indexOf(r);
        if (idx !== -1) mockExchangeRates.splice(idx, 1);
      }
      return Promise.resolve(results.length);
    },
  };
}

vi.mock("../db/database", () => {
  const db = {
    settings: {
      get: (key: string) =>
        Promise.resolve(mockSettings.has(key) ? { key, value: mockSettings.get(key) } : undefined),
    },
    exchangeRates: {
      where: (field: string) => {
        return {
          equals: (val: unknown) => {
            if (field === "[baseCurrency+date]") {
              const [base, date] = val as [string, string];
              const found = mockExchangeRates.filter(
                (e) => e.baseCurrency === base && e.date === date,
              );
              return makeQuery(found);
            }
            if (field === "baseCurrency") {
              const found = mockExchangeRates.filter((e) => e.baseCurrency === val);
              return makeQuery(found);
            }
            return makeQuery([]);
          },
          between: (_lower: unknown, upper: unknown, _incLower: boolean, _incUpper: boolean) => {
            if (field === "[baseCurrency+date]") {
              const [base, maxDate] = upper as [string, string];
              const found = mockExchangeRates
                .filter((e) => e.baseCurrency === base && e.date <= maxDate)
                .sort((a, b) => a.date.localeCompare(b.date));
              return makeQuery(found);
            }
            return makeQuery([]);
          },
          below: (cutoff: string) => {
            const found = mockExchangeRates.filter((e) => e.date < cutoff);
            return makeQuery(found);
          },
          last: () => {
            if (field === "baseCurrency") {
              return Promise.resolve(mockExchangeRates[mockExchangeRates.length - 1] ?? undefined);
            }
            return Promise.resolve(undefined);
          },
        };
      },
      add: (entry: (typeof mockExchangeRates)[number]) => {
        const id = nextId++;
        mockExchangeRates.push({ ...entry, id });
        return Promise.resolve(id);
      },
      update: (id: number, changes: Partial<(typeof mockExchangeRates)[number]>) => {
        const entry = mockExchangeRates.find((e) => e.id === id);
        if (entry) Object.assign(entry, changes);
        return Promise.resolve(1);
      },
    },
    transactions: {
      toArray: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve(1)),
    },
    transaction: vi.fn((_mode: string, _tables: unknown, fn: () => Promise<void>) => fn()),
  };
  return { db };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

import { exchangeRateService } from "./exchange-rate.service";
import { db } from "../db/database";

const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
const FRESH = new Date().toISOString();
const STALE = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago

function clearRates() {
  mockExchangeRates.length = 0;
}

function addCacheEntry(
  baseCurrency: string,
  date: string,
  rates: Record<string, number>,
  fetchedAt = FRESH,
) {
  const id = nextId++;
  mockExchangeRates.push({ id, baseCurrency, date, rates, fetchedAt });
}

beforeEach(() => {
  clearRates();
  mockSettings.set("mainCurrency", "USD");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Cache hit — no network call ───────────────────────────────────────────────

describe("getRate — cache hit", () => {
  it("returns correct direct rate without fetching when cache is fresh", async () => {
    addCacheEntry("USD", TODAY, { EUR: 0.9, PLN: 4.0 }, FRESH);

    const rate = await exchangeRateService.getRate("EUR", "PLN");

    expect(fetch).not.toHaveBeenCalled();
    // Cross-rate: EUR→PLN with USD as base
    // rates[EUR]=0.9, rates[PLN]=4.0 → PLN/EUR = 4.0/0.9 ≈ 4.4444
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
  });

  it("returns 1 when from === to", async () => {
    const rate = await exchangeRateService.getRate("USD", "USD");
    expect(rate).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns correct rate when from is the base currency", async () => {
    // main currency = USD, converting USD → EUR
    // rates[EUR] = 0.9 → 1 USD = 0.9 EUR
    addCacheEntry("USD", TODAY, { EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate("USD", "EUR");
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(0.9, 5);
  });

  it("returns correct rate when to is the base currency", async () => {
    // main currency = USD, converting EUR → USD
    // rates[EUR] = 0.9 → 1 EUR = 1/0.9 USD
    addCacheEntry("USD", TODAY, { EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate("EUR", "USD");
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(1 / 0.9, 5);
  });
});

// ── Cache miss — triggers fetch ───────────────────────────────────────────────

describe("getRate — cache miss triggers fetch", () => {
  it("calls the API and caches result when no entry exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9, PLN: 4.0 } }),
      }),
    );

    const rate = await exchangeRateService.getRate("EUR", "PLN");

    expect(fetch).toHaveBeenCalledWith("https://open.er-api.com/v6/latest/USD");
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
    // Entry should now be cached
    expect(mockExchangeRates.length).toBe(1);
    expect(mockExchangeRates[0].baseCurrency).toBe("USD");
  });

  it("fetches when cache entry is stale (>24h)", async () => {
    addCacheEntry("USD", TODAY, { EUR: 0.9, PLN: 3.5 }, STALE);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9, PLN: 4.0 } }),
      }),
    );

    const rate = await exchangeRateService.getRate("EUR", "PLN");

    expect(fetch).toHaveBeenCalled();
    // Uses the refreshed rate
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
  });
});

// ── Cross-rate calculation ────────────────────────────────────────────────────

describe("cross-rate calculation", () => {
  it("correctly computes cross-rate between two non-base currencies", async () => {
    // Base = USD, rates: 1 USD = 4 PLN, 1 USD = 0.9 EUR
    // 1 PLN = ? EUR → rates[EUR] / rates[PLN] = 0.9 / 4 = 0.225
    addCacheEntry("USD", TODAY, { PLN: 4.0, EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate("PLN", "EUR");
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(0.9 / 4.0, 5);
  });

  it("correctly computes cross-rate in the other direction", async () => {
    // 1 EUR = ? PLN → rates[PLN] / rates[EUR] = 4.0 / 0.9
    addCacheEntry("USD", TODAY, { PLN: 4.0, EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate("EUR", "PLN");
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
  });
});

// ── No cache + fetch fails → null ────────────────────────────────────────────

describe("getRate — null when no cache and fetch fails", () => {
  it("returns null when fetch fails and no cached entry exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const rate = await exchangeRateService.getRate("EUR", "PLN");

    expect(fetch).toHaveBeenCalled();
    expect(rate).toBeNull();
  });

  it("returns null when fetch fails with non-ok response and no cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const rate = await exchangeRateService.getRate("EUR", "PLN");

    expect(rate).toBeNull();
  });

  it("uses stale cache when fetch fails and stale entry exists", async () => {
    // Add a stale entry from yesterday
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString().slice(0, 10);
    addCacheEntry("USD", yesterday, { EUR: 0.88, PLN: 3.9 }, STALE);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    // No today entry → cache miss path → fetch fails → fallback to any cached entry
    const rate = await exchangeRateService.getRate("EUR", "PLN");

    expect(rate).toBeCloseTo(3.9 / 0.88, 5);
  });
});

// ── getHistoricalRate ─────────────────────────────────────────────────────────

describe("getHistoricalRate", () => {
  it("returns rate from the most recent entry on or before requested date", async () => {
    addCacheEntry("USD", "2024-01-01", { EUR: 0.85 }, FRESH);
    addCacheEntry("USD", "2024-06-01", { EUR: 0.92 }, FRESH);

    // Request date between the two entries → should pick 2024-06-01
    const rate = await exchangeRateService.getHistoricalRate("EUR", "USD", "2024-08-15");
    // EUR→USD with USD base: 1/rates[EUR] = 1/0.92
    expect(rate).toBeCloseTo(1 / 0.92, 5);
  });

  it("returns null when no entry exists at or before the date", async () => {
    addCacheEntry("USD", "2024-06-01", { EUR: 0.92 }, FRESH);

    const rate = await exchangeRateService.getHistoricalRate("EUR", "USD", "2024-01-01");
    expect(rate).toBeNull();
  });

  it("returns 1 when from === to", async () => {
    const rate = await exchangeRateService.getHistoricalRate("USD", "USD", TODAY);
    expect(rate).toBe(1);
  });
});

// ── recalculateAllMainCurrencyAmounts ────────────────────────────────────────

describe("recalculateAllMainCurrencyAmounts", () => {
  type MockTx = {
    id: number;
    currency: string;
    amount: number;
    date: string;
    exchangeRate?: number;
    amountMainCurrency?: number;
  };

  let mockTransactions: MockTx[] = [];
  const txUpdates: Array<{ id: number; changes: Record<string, unknown> }> = [];

  beforeEach(() => {
    mockTransactions = [];
    txUpdates.length = 0;

    const txMock = db.transactions as unknown as {
      toArray: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    // Wire toArray to return current mockTransactions snapshot
    txMock.toArray.mockImplementation(() => Promise.resolve([...mockTransactions]));

    // Wire update to record calls and mutate in-place
    txMock.update.mockImplementation((id: number, changes: Record<string, unknown>) => {
      txUpdates.push({ id, changes });
      const tx = mockTransactions.find((t) => t.id === id);
      if (tx) Object.assign(tx, changes);
      return Promise.resolve(1);
    });

    // Stub fetch so fetchAndCacheRates succeeds by default
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { EUR: 0.85, GBP: 0.75 } }),
    } as Response);
  });

  it("calls onProgress(0, 0) and makes no update calls when there are no transactions", async () => {
    mockTransactions = [];
    const onProgress = vi.fn();

    await exchangeRateService.recalculateAllMainCurrencyAmounts("USD", onProgress);

    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(0, 0);
    expect(txUpdates).toHaveLength(0);
  });

  it("sets exchangeRate=1 and amountMainCurrency=Math.round(amount) for transactions already in the new currency", async () => {
    mockTransactions = [
      { id: 1, currency: "USD", amount: 1050, date: "2024-03-01" },
      { id: 2, currency: "USD", amount: 2099, date: "2024-03-02" },
    ];

    await exchangeRateService.recalculateAllMainCurrencyAmounts("USD");

    expect(txUpdates).toHaveLength(2);
    expect(txUpdates[0].changes).toMatchObject({ exchangeRate: 1, amountMainCurrency: 1050 });
    expect(txUpdates[1].changes).toMatchObject({ exchangeRate: 1, amountMainCurrency: 2099 });
    // Verify integer
    expect(Number.isInteger(txUpdates[0].changes.amountMainCurrency)).toBe(true);
    expect(Number.isInteger(txUpdates[1].changes.amountMainCurrency)).toBe(true);
  });

  it("sets amountMainCurrency = Math.round(amount * rate) — always an integer, never a float", async () => {
    // rate = 1.08, amount = 1000 (integer minor units = $10.00)
    // 1000 * 1.08 = 1080 exactly, but use a rate that exposes float precision:
    // rate = 1/3 would give 333.333...; use rate=0.333 → Math.round(1000*0.333) = 333
    // More interesting: use amount=100, rate that gives non-integer: 100 * 1.08 = 108 (still int)
    // Use amount=1099, rate=1.08 → 1099 * 1.08 = 1186.92 → Math.round = 1187
    mockTransactions = [{ id: 1, currency: "EUR", amount: 1099, date: "2024-03-01" }];

    vi.spyOn(exchangeRateService, "getHistoricalRate").mockResolvedValue(1.08);

    await exchangeRateService.recalculateAllMainCurrencyAmounts("USD");

    expect(txUpdates).toHaveLength(1);
    const { amountMainCurrency } = txUpdates[0].changes as { amountMainCurrency: number };
    // 1099 * 1.08 = 1186.92 → rounded = 1187
    expect(amountMainCurrency).toBe(1187);
    expect(Number.isInteger(amountMainCurrency)).toBe(true);
    // Verify it is NOT the raw float product
    expect(amountMainCurrency).not.toBe(1099 * 1.08);
  });

  it("throws with the currency name when a rate is missing for a transaction currency", async () => {
    mockTransactions = [{ id: 1, currency: "EUR", amount: 500, date: "2024-03-01" }];

    vi.spyOn(exchangeRateService, "getHistoricalRate").mockResolvedValue(null);

    await expect(exchangeRateService.recalculateAllMainCurrencyAmounts("USD")).rejects.toThrow(
      "No exchange rate available for: EUR",
    );
  });

  it("propagates the error when fetchAndCacheRates throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    await expect(exchangeRateService.recalculateAllMainCurrencyAmounts("USD")).rejects.toThrow(
      "Network error",
    );

    expect(txUpdates).toHaveLength(0);
  });

  it("calls onProgress with correct (done, total) after each batch", async () => {
    // 3 transactions — all fit in 1 batch (BATCH_SIZE=50), so onProgress called once with (3, 3)
    mockTransactions = [
      { id: 1, currency: "EUR", amount: 1000, date: "2024-03-01" },
      { id: 2, currency: "EUR", amount: 2000, date: "2024-03-01" },
      { id: 3, currency: "USD", amount: 500, date: "2024-03-02" },
    ];

    vi.spyOn(exchangeRateService, "getHistoricalRate").mockResolvedValue(1.08);

    const progressCalls: Array<[number, number]> = [];
    const onProgress = vi.fn((done: number, total: number) => {
      progressCalls.push([done, total]);
    });

    await exchangeRateService.recalculateAllMainCurrencyAmounts("USD", onProgress);

    // All 3 in one batch → single onProgress call with (3, 3)
    expect(progressCalls).toEqual([[3, 3]]);
  });

  it("calls onProgress multiple times when transactions span multiple batches", async () => {
    // Create 55 transactions (> BATCH_SIZE=50) to force 2 batches
    mockTransactions = Array.from({ length: 55 }, (_, i) => ({
      id: i + 1,
      currency: "EUR",
      amount: 1000,
      date: "2024-03-01",
    }));

    vi.spyOn(exchangeRateService, "getHistoricalRate").mockResolvedValue(1.0);

    const progressCalls: Array<[number, number]> = [];
    const onProgress = vi.fn((done: number, total: number) => {
      progressCalls.push([done, total]);
    });

    await exchangeRateService.recalculateAllMainCurrencyAmounts("USD", onProgress);

    // Batch 1: items 0–49 → done=50, total=55
    // Batch 2: items 50–54 → done=55, total=55
    expect(progressCalls).toEqual([
      [50, 55],
      [55, 55],
    ]);
  });
});

// ── fetchAndCacheRates ────────────────────────────────────────────────────────

describe("fetchAndCacheRates", () => {
  it("throws when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    await expect(exchangeRateService.fetchAndCacheRates("USD")).rejects.toThrow();
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(exchangeRateService.fetchAndCacheRates("USD")).rejects.toThrow("503");
  });

  it("stores fetched rates in the db", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9, PLN: 4.0 } }),
      }),
    );

    await exchangeRateService.fetchAndCacheRates("USD");

    expect(mockExchangeRates.length).toBe(1);
    expect(mockExchangeRates[0].baseCurrency).toBe("USD");
    expect(mockExchangeRates[0].rates).toEqual({ EUR: 0.9, PLN: 4.0 });
  });

  it("updates existing entry for same base+date", async () => {
    addCacheEntry("USD", TODAY, { EUR: 0.85 }, STALE);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9 } }),
      }),
    );

    await exchangeRateService.fetchAndCacheRates("USD");

    // Should still be 1 entry, updated
    expect(mockExchangeRates.length).toBe(1);
    expect(mockExchangeRates[0].rates).toEqual({ EUR: 0.9 });
  });
});
