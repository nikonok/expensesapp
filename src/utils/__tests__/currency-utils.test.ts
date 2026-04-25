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
});
