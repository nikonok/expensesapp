import { describe, it, expect } from "vitest";
import {
  formatAmount,
  formatAmountNoSymbol,
  convertAmount,
  getCurrencySymbol,
  getCurrencyDecimalPlaces,
} from "../currency-utils";

describe("formatAmount", () => {
  it("formats USD with dollar sign and comma thousands separator", () => {
    const result = formatAmount(100000, "USD", "en-US");
    expect(result).toBe("$1,000.00");
  });

  it("formats PLN with comma decimal and zł symbol (pl-PL locale)", () => {
    const result = formatAmount(100000, "PLN", "pl-PL");
    // Polish locale uses comma as decimal separator and zł as currency symbol
    expect(result).toMatch(/1[\s\u00a0\u202f]?000,00/);
    expect(result).toMatch(/zł/);
  });

  it("formats zero USD correctly", () => {
    expect(formatAmount(0, "USD", "en-US")).toBe("$0.00");
  });

  it("formats negative USD correctly", () => {
    expect(formatAmount(-50000, "USD", "en-US")).toBe("-$500.00");
  });
});

describe("formatAmountNoSymbol", () => {
  it("returns number without currency symbol for USD", () => {
    const result = formatAmountNoSymbol(100000, "USD", "en-US");
    expect(result).toBe("1,000.00");
  });

  it("returns number without currency symbol for PLN (pl-PL locale)", () => {
    const result = formatAmountNoSymbol(100000, "PLN", "pl-PL");
    // Polish locale uses comma as decimal separator; no currency symbol
    expect(result).toMatch(/1[\s\u00a0\u202f]?000,00/);
    expect(result).not.toMatch(/zł/);
  });
});

describe("convertAmount", () => {
  it("multiplies amount by rate and rounds to nearest integer", () => {
    expect(convertAmount(1000, 3.5)).toBe(3500);
  });

  it("rounds correctly", () => {
    expect(convertAmount(1000, 3.3337)).toBe(3334);
  });

  it("handles zero rate", () => {
    expect(convertAmount(1000, 0)).toBe(0);
  });
});

describe("getCurrencySymbol", () => {
  it("returns $ for USD", () => {
    expect(getCurrencySymbol("USD", "en-US")).toBe("$");
  });

  it("returns zł for PLN (pl-PL locale)", () => {
    expect(getCurrencySymbol("PLN", "pl-PL")).toBe("zł");
  });
});

describe("getCurrencyDecimalPlaces", () => {
  it("returns 2 for USD", () => {
    expect(getCurrencyDecimalPlaces("USD")).toBe(2);
  });

  it("returns 2 for EUR", () => {
    expect(getCurrencyDecimalPlaces("EUR")).toBe(2);
  });

  it("returns 0 for JPY", () => {
    expect(getCurrencyDecimalPlaces("JPY")).toBe(0);
  });

  it("returns 3 for KWD", () => {
    expect(getCurrencyDecimalPlaces("KWD")).toBe(3);
  });

  it("returns 2 for an invalid currency code (fallback)", () => {
    expect(getCurrencyDecimalPlaces("INVALID")).toBe(2);
  });

  it("returns cached value on second call (exercises the Map cache path)", () => {
    // Call twice — first populates cache, second reads from it
    const first = getCurrencyDecimalPlaces("AUD");
    const second = getCurrencyDecimalPlaces("AUD");
    expect(second).toBe(first);
    expect(second).toBe(2);
  });
});

describe("formatAmount — zero-decimal and three-decimal currencies", () => {
  it("formats JPY: app divides by 100 universally, so 50000 minor units display as ¥500", () => {
    // JPY has no subunit — 1 JPY = 1 minor unit in the real world.
    // The app stores all amounts in minor units with /100 division on display.
    // So 50000 stored → 50000/100 = 500 yen displayed. This is the documented behavior.
    const result = formatAmount(50000, "JPY", "en-US");
    expect(result).toBe("¥500");
  });

  it("formats KWD: 10000 minor units → 100 KWD displayed (3 decimal places via Intl)", () => {
    // KWD has 3 decimal places. 10000 / 100 = 100.000 KWD.
    const result = formatAmount(10000, "KWD", "en-US");
    expect(result).toBe("KWD 100.000");
  });
});

describe("formatAmountNoSymbol — zero-decimal currencies", () => {
  it("formats JPY with hardcoded 2 decimal places: 50000 → '500.00'", () => {
    // formatAmountNoSymbol uses style:'decimal' with maximumFractionDigits:2 regardless of
    // the currency's native decimal count. JPY would normally display as '500' but the
    // app always shows 2 decimal places here.
    const result = formatAmountNoSymbol(50000, "JPY", "en-US");
    expect(result).toBe("500.00");
  });
});

describe("convertAmount — edge cases", () => {
  it("handles negative amounts (e.g. DEBT balance)", () => {
    // DEBT account balances are negative. convertAmount is called with Math.abs in
    // use-total-balance.ts, but the function itself must handle negatives correctly.
    expect(convertAmount(-1000, 1.5)).toBe(-1500);
  });

  it("handles negative rate edge case", () => {
    expect(convertAmount(1000, -2)).toBe(-2000);
  });

  it("accepts optional source+target dp arguments (signature only)", () => {
    // convertAmount must accept dp args so call sites in the sync engine can
    // pass them without TS errors. The math is unchanged because stored minor
    // units use a uniform /100 scale across the app.
    expect(convertAmount(1000, 1.5, 2, 2)).toBe(1500);
    expect(convertAmount(1000, 1.5, 0, 2)).toBe(1500);
    expect(convertAmount(1000, 1.5, 2, 3)).toBe(1500);
  });
});

describe("getCurrencyDecimalPlaces — extended currency coverage", () => {
  it("returns 3 for BHD", () => {
    expect(getCurrencyDecimalPlaces("BHD")).toBe(3);
  });

  it("returns 0 for KRW (Korean Won)", () => {
    // KRW has no minor unit, like JPY.
    expect(getCurrencyDecimalPlaces("KRW")).toBe(0);
  });

  it("returns 2 for GBP", () => {
    expect(getCurrencyDecimalPlaces("GBP")).toBe(2);
  });

  // CLF (Chilean Unidad de Fomento) has 4 decimal places in ISO 4217.
  // Some Intl implementations report only 2 — accept whichever Node provides.
  it("returns a sensible dp for CLF (4 per ISO, may be 2 on older Intl)", () => {
    const dp = getCurrencyDecimalPlaces("CLF");
    expect(dp === 2 || dp === 4).toBe(true);
  });
});

describe("convertAmount — JPY/KWD/BHD edge cases", () => {
  it("JPY → USD: 50000 minor (¥500) × 0.0067 → 335 minor (~$3.35)", () => {
    // The /100 storage convention means the converted amount is still in /100
    // minor units regardless of native dp; the rate handles the value mapping.
    expect(convertAmount(50000, 0.0067)).toBe(335);
  });

  it("USD → JPY: 1000 minor ($10) × 150 → 150000 minor (¥1500)", () => {
    expect(convertAmount(1000, 150)).toBe(150000);
  });

  it("USD → KWD: 10000 minor ($100) × 0.3075 → 3075 minor (~0.3075 KWD)", () => {
    expect(convertAmount(10000, 0.3075)).toBe(3075);
  });

  it("USD → BHD: 10000 minor ($100) × 0.376 → 3760 minor (~0.376 BHD)", () => {
    expect(convertAmount(10000, 0.376)).toBe(3760);
  });

  it("rounds half-to-even-ish (Math.round): 100 × 0.005 → 1 (boundary)", () => {
    // 100 * 0.005 = 0.5 — Math.round produces 1 (half-up). This matches the
    // existing convention; do not silently change rounding behaviour.
    expect(convertAmount(100, 0.005)).toBe(1);
  });
});
