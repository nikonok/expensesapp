import { describe, it, expect } from 'vitest';
import { CURRENCY_ALIASES, levenshteinAtMost1, filterCurrencies } from '../currency-search';

const stubNames: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound Sterling',
  JPY: 'Japanese Yen',
  PEN: 'Peruvian Sol',
  PLN: 'Polish Zloty',
  BRL: 'Brazilian Real',
  CAD: 'Canadian Dollar',
  CNY: 'Chinese Yuan',
  KRW: 'South Korean Won',
};
const getName = (c: string): string => stubNames[c] ?? c;
const codes = Object.keys(stubNames);

describe('levenshteinAtMost1', () => {
  it('returns true for equal strings', () => {
    expect(levenshteinAtMost1('hello', 'hello')).toBe(true);
  });

  it('returns true for one substitution: cat / bat', () => {
    expect(levenshteinAtMost1('cat', 'bat')).toBe(true);
  });

  it('returns true for one insertion: dolar / dollar', () => {
    expect(levenshteinAtMost1('dolar', 'dollar')).toBe(true);
  });

  it('returns true for one deletion: euroo / euro', () => {
    expect(levenshteinAtMost1('euroo', 'euro')).toBe(true);
  });

  it('returns false for two edits: kats / dogs', () => {
    expect(levenshteinAtMost1('kats', 'dogs')).toBe(false);
  });

  it('returns false when length difference is greater than 1: a / abc', () => {
    expect(levenshteinAtMost1('a', 'abc')).toBe(false);
  });

  it('returns true for empty vs 1-char string', () => {
    expect(levenshteinAtMost1('', 'a')).toBe(true);
  });

  it('returns true for empty vs empty string', () => {
    expect(levenshteinAtMost1('', '')).toBe(true);
  });

  it('is case sensitive (handles already-lowercased strings)', () => {
    expect(levenshteinAtMost1('euro', 'euro')).toBe(true);
    expect(levenshteinAtMost1('dollar', 'dollar')).toBe(true);
  });
});

describe('filterCurrencies — empty/blank query', () => {
  it('returns all codes when query is empty string', () => {
    const result = filterCurrencies(codes, '', getName);
    expect(result).toHaveLength(codes.length);
    for (const code of codes) {
      expect(result).toContain(code);
    }
  });

  it('returns all codes when query is whitespace-only', () => {
    const result = filterCurrencies(codes, '   ', getName);
    expect(result).toHaveLength(codes.length);
    for (const code of codes) {
      expect(result).toContain(code);
    }
  });

  it('returned array does not share reference with input', () => {
    const result = filterCurrencies(codes, '', getName);
    result.push('ZZZ');
    expect(codes).not.toContain('ZZZ');
  });
});

describe('filterCurrencies — exact/substring tier', () => {
  it('includes USD when query is lowercase usd', () => {
    const result = filterCurrencies(codes, 'usd', getName);
    expect(result).toContain('USD');
  });

  it('includes USD when query is uppercase USD (case insensitive)', () => {
    const result = filterCurrencies(codes, 'USD', getName);
    expect(result).toContain('USD');
  });

  it('includes both USD and CAD when query is dollar (shared name token)', () => {
    const result = filterCurrencies(codes, 'dollar', getName);
    expect(result).toContain('USD');
    expect(result).toContain('CAD');
  });

  it('includes EUR when query is euro (name match)', () => {
    const result = filterCurrencies(codes, 'euro', getName);
    expect(result).toContain('EUR');
  });

  it('includes USD when query is us (substring of name "US Dollar")', () => {
    const result = filterCurrencies(codes, 'us', getName);
    expect(result).toContain('USD');
  });

  it('includes JPY when query is yen (alias match)', () => {
    const result = filterCurrencies(codes, 'yen', getName);
    expect(result).toContain('JPY');
  });

  it('includes CNY when query is rmb (alias match)', () => {
    const result = filterCurrencies(codes, 'rmb', getName);
    expect(result).toContain('CNY');
  });

  it('eur query exact-matches EUR and does not include PEN as false positive', () => {
    const result = filterCurrencies(codes, 'eur', getName);
    expect(result).toContain('EUR');
    expect(result).not.toContain('PEN');
  });
});

describe('filterCurrencies — fuzzy tier', () => {
  it('includes USD when query is dolar (missing one l — fuzzy via alias token dollar)', () => {
    const result = filterCurrencies(codes, 'dolar', getName);
    expect(result).toContain('USD');
  });

  it('includes EUR when query is euroo (one extra char)', () => {
    const result = filterCurrencies(codes, 'euroo', getName);
    expect(result).toContain('EUR');
  });

  it('includes USD when query is "us dolar" (multi-token, one exact one fuzzy)', () => {
    const result = filterCurrencies(codes, 'us dolar', getName);
    expect(result).toContain('USD');
  });

  it('includes JPY when query is yenn (one extra char)', () => {
    const result = filterCurrencies(codes, 'yenn', getName);
    expect(result).toContain('JPY');
  });

  it('returns empty array when query is xyz (no match)', () => {
    const result = filterCurrencies(codes, 'xyz', getName);
    expect(result).toEqual([]);
  });

  it('returns empty array when one token matches but the other does not (us xyz)', () => {
    const result = filterCurrencies(codes, 'us xyz', getName);
    expect(result).toEqual([]);
  });

  it('does not add extra fuzzy hits when exact tier already returned results for usd', () => {
    const exactResult = filterCurrencies(codes, 'usd', getName);
    expect(exactResult).toContain('USD');
    // exact match found — fuzzy tier should not add unrelated currencies
    // verify result size is bounded (should not be all currencies)
    expect(exactResult.length).toBeLessThan(codes.length);
  });
});

describe('filterCurrencies — no match', () => {
  it('returns empty array for zzz', () => {
    expect(filterCurrencies(codes, 'zzz', getName)).toEqual([]);
  });

  it('returns empty array for qqqq', () => {
    expect(filterCurrencies(codes, 'qqqq', getName)).toEqual([]);
  });
});

describe('filterCurrencies — alias coverage', () => {
  it('includes PLN when query is zl (alias from CURRENCY_ALIASES)', () => {
    expect(CURRENCY_ALIASES['PLN']).toBeDefined();
    const result = filterCurrencies(codes, 'zl', getName);
    expect(result).toContain('PLN');
  });

  it('includes GBP when query is quid (alias from CURRENCY_ALIASES)', () => {
    expect(CURRENCY_ALIASES['GBP']).toBeDefined();
    const result = filterCurrencies(codes, 'quid', getName);
    expect(result).toContain('GBP');
  });

  it('includes KRW when query is won (alias from CURRENCY_ALIASES)', () => {
    expect(CURRENCY_ALIASES['KRW']).toBeDefined();
    const result = filterCurrencies(codes, 'won', getName);
    expect(result).toContain('KRW');
  });
});
