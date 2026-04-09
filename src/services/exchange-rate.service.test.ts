import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../db/database', () => {
  const db = {
    settings: {
      get: (key: string) => Promise.resolve(
        mockSettings.has(key) ? { key, value: mockSettings.get(key) } : undefined
      ),
    },
    exchangeRates: {
      where: (field: string) => {
        return {
          equals: (val: unknown) => {
            if (field === '[baseCurrency+date]') {
              const [base, date] = val as [string, string];
              const found = mockExchangeRates.filter(
                (e) => e.baseCurrency === base && e.date === date
              );
              return makeQuery(found);
            }
            if (field === 'baseCurrency') {
              const found = mockExchangeRates.filter(
                (e) => e.baseCurrency === val
              );
              return makeQuery(found);
            }
            return makeQuery([]);
          },
          between: (_lower: unknown, upper: unknown, _incLower: boolean, _incUpper: boolean) => {
            if (field === '[baseCurrency+date]') {
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
            if (field === 'baseCurrency') {
              return Promise.resolve(
                mockExchangeRates[mockExchangeRates.length - 1] ?? undefined
              );
            }
            return Promise.resolve(undefined);
          },
        };
      },
      add: (entry: typeof mockExchangeRates[number]) => {
        const id = nextId++;
        mockExchangeRates.push({ ...entry, id });
        return Promise.resolve(id);
      },
      update: (id: number, changes: Partial<typeof mockExchangeRates[number]>) => {
        const entry = mockExchangeRates.find((e) => e.id === id);
        if (entry) Object.assign(entry, changes);
        return Promise.resolve(1);
      },
    },
    transactions: {
      toArray: () => Promise.resolve([]),
      update: () => Promise.resolve(1),
    },
    transaction: (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
  };
  return { db };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

import { exchangeRateService } from './exchange-rate.service';

const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
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
  mockSettings.set('mainCurrency', 'USD');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Cache hit — no network call ───────────────────────────────────────────────

describe('getRate — cache hit', () => {
  it('returns correct direct rate without fetching when cache is fresh', async () => {
    addCacheEntry('USD', TODAY, { EUR: 0.9, PLN: 4.0 }, FRESH);

    const rate = await exchangeRateService.getRate('EUR', 'PLN');

    expect(fetch).not.toHaveBeenCalled();
    // Cross-rate: EUR→PLN with USD as base
    // rates[EUR]=0.9, rates[PLN]=4.0 → PLN/EUR = 4.0/0.9 ≈ 4.4444
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
  });

  it('returns 1 when from === to', async () => {
    const rate = await exchangeRateService.getRate('USD', 'USD');
    expect(rate).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns correct rate when from is the base currency', async () => {
    // main currency = USD, converting USD → EUR
    // rates[EUR] = 0.9 → 1 USD = 0.9 EUR
    addCacheEntry('USD', TODAY, { EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate('USD', 'EUR');
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(0.9, 5);
  });

  it('returns correct rate when to is the base currency', async () => {
    // main currency = USD, converting EUR → USD
    // rates[EUR] = 0.9 → 1 EUR = 1/0.9 USD
    addCacheEntry('USD', TODAY, { EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate('EUR', 'USD');
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(1 / 0.9, 5);
  });
});

// ── Cache miss — triggers fetch ───────────────────────────────────────────────

describe('getRate — cache miss triggers fetch', () => {
  it('calls the API and caches result when no entry exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9, PLN: 4.0 } }),
      }),
    );

    const rate = await exchangeRateService.getRate('EUR', 'PLN');

    expect(fetch).toHaveBeenCalledWith(
      'https://open.er-api.com/v6/latest/USD',
    );
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
    // Entry should now be cached
    expect(mockExchangeRates.length).toBe(1);
    expect(mockExchangeRates[0].baseCurrency).toBe('USD');
  });

  it('fetches when cache entry is stale (>24h)', async () => {
    addCacheEntry('USD', TODAY, { EUR: 0.9, PLN: 3.5 }, STALE);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9, PLN: 4.0 } }),
      }),
    );

    const rate = await exchangeRateService.getRate('EUR', 'PLN');

    expect(fetch).toHaveBeenCalled();
    // Uses the refreshed rate
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
  });
});

// ── Cross-rate calculation ────────────────────────────────────────────────────

describe('cross-rate calculation', () => {
  it('correctly computes cross-rate between two non-base currencies', async () => {
    // Base = USD, rates: 1 USD = 4 PLN, 1 USD = 0.9 EUR
    // 1 PLN = ? EUR → rates[EUR] / rates[PLN] = 0.9 / 4 = 0.225
    addCacheEntry('USD', TODAY, { PLN: 4.0, EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate('PLN', 'EUR');
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(0.9 / 4.0, 5);
  });

  it('correctly computes cross-rate in the other direction', async () => {
    // 1 EUR = ? PLN → rates[PLN] / rates[EUR] = 4.0 / 0.9
    addCacheEntry('USD', TODAY, { PLN: 4.0, EUR: 0.9 }, FRESH);

    const rate = await exchangeRateService.getRate('EUR', 'PLN');
    expect(fetch).not.toHaveBeenCalled();
    expect(rate).toBeCloseTo(4.0 / 0.9, 5);
  });
});

// ── No cache + fetch fails → null ────────────────────────────────────────────

describe('getRate — null when no cache and fetch fails', () => {
  it('returns null when fetch fails and no cached entry exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    const rate = await exchangeRateService.getRate('EUR', 'PLN');

    expect(fetch).toHaveBeenCalled();
    expect(rate).toBeNull();
  });

  it('returns null when fetch fails with non-ok response and no cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    const rate = await exchangeRateService.getRate('EUR', 'PLN');

    expect(rate).toBeNull();
  });

  it('uses stale cache when fetch fails and stale entry exists', async () => {
    // Add a stale entry from yesterday
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    addCacheEntry('USD', yesterday, { EUR: 0.88, PLN: 3.9 }, STALE);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    // No today entry → cache miss path → fetch fails → fallback to any cached entry
    const rate = await exchangeRateService.getRate('EUR', 'PLN');

    expect(rate).toBeCloseTo(3.9 / 0.88, 5);
  });
});

// ── getHistoricalRate ─────────────────────────────────────────────────────────

describe('getHistoricalRate', () => {
  it('returns rate from the most recent entry on or before requested date', async () => {
    addCacheEntry('USD', '2024-01-01', { EUR: 0.85 }, FRESH);
    addCacheEntry('USD', '2024-06-01', { EUR: 0.92 }, FRESH);

    // Request date between the two entries → should pick 2024-06-01
    const rate = await exchangeRateService.getHistoricalRate('EUR', 'USD', '2024-08-15');
    // EUR→USD with USD base: 1/rates[EUR] = 1/0.92
    expect(rate).toBeCloseTo(1 / 0.92, 5);
  });

  it('returns null when no entry exists at or before the date', async () => {
    addCacheEntry('USD', '2024-06-01', { EUR: 0.92 }, FRESH);

    const rate = await exchangeRateService.getHistoricalRate('EUR', 'USD', '2024-01-01');
    expect(rate).toBeNull();
  });

  it('returns 1 when from === to', async () => {
    const rate = await exchangeRateService.getHistoricalRate('USD', 'USD', TODAY);
    expect(rate).toBe(1);
  });
});

// ── fetchAndCacheRates ────────────────────────────────────────────────────────

describe('fetchAndCacheRates', () => {
  it('throws when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    await expect(
      exchangeRateService.fetchAndCacheRates('USD'),
    ).rejects.toThrow();
  });

  it('throws when response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    await expect(
      exchangeRateService.fetchAndCacheRates('USD'),
    ).rejects.toThrow('503');
  });

  it('stores fetched rates in the db', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9, PLN: 4.0 } }),
      }),
    );

    await exchangeRateService.fetchAndCacheRates('USD');

    expect(mockExchangeRates.length).toBe(1);
    expect(mockExchangeRates[0].baseCurrency).toBe('USD');
    expect(mockExchangeRates[0].rates).toEqual({ EUR: 0.9, PLN: 4.0 });
  });

  it('updates existing entry for same base+date', async () => {
    addCacheEntry('USD', TODAY, { EUR: 0.85 }, STALE);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.9 } }),
      }),
    );

    await exchangeRateService.fetchAndCacheRates('USD');

    // Should still be 1 entry, updated
    expect(mockExchangeRates.length).toBe(1);
    expect(mockExchangeRates[0].rates).toEqual({ EUR: 0.9 });
  });
});
