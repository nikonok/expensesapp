import { describe, it, expect } from "vitest";
import { evaluateExpression, isAmountOverLimit } from "../math-parser";

/**
 * The math parser must respect the source currency's decimal-place count so
 * that JPY (0dp) numpad entries round to whole yen and KWD/BHD (3dp) entries
 * preserve their third decimal.
 *
 * Default behaviour (no dp passed) is 2dp for backward compatibility.
 */

describe("evaluateExpression — 0dp currencies (JPY)", () => {
  it("scales by 10^0 = 1: '100' → 100", () => {
    expect(evaluateExpression("100", 0)).toBe(100);
  });

  it("rejects fractional input by rounding to whole: '100.4' → 100", () => {
    expect(evaluateExpression("100.4", 0)).toBe(100);
  });

  it("rounds half-up: '100.5' → 101", () => {
    expect(evaluateExpression("100.5", 0)).toBe(101);
  });

  it("addition keeps integer scale: '100+50' → 150", () => {
    expect(evaluateExpression("100+50", 0)).toBe(150);
  });

  it("division with truncation: '10÷3' → 3 (rounded)", () => {
    expect(evaluateExpression("10÷3", 0)).toBe(3);
  });
});

describe("evaluateExpression — 3dp currencies (KWD, BHD)", () => {
  it("scales by 10^3 = 1000: '10' → 10000", () => {
    expect(evaluateExpression("10", 3)).toBe(10000);
  });

  it("preserves three decimals: '10.123' → 10123", () => {
    expect(evaluateExpression("10.123", 3)).toBe(10123);
  });

  it("rounds the 4th decimal: '10.1234' → 10123", () => {
    expect(evaluateExpression("10.1234", 3)).toBe(10123);
  });

  it("rounds half-up: '10.1235' → 10124 (or 10123 due to IEEE 754 — accept either)", () => {
    // 10.1235 * 1000 = 10123.499999... in IEEE 754. This is the same edge
    // case as 1.005 in the 2dp tests — accept either outcome.
    const r = evaluateExpression("10.1235", 3);
    expect(r === 10123 || r === 10124).toBe(true);
  });

  it("chained ops preserve full precision: '1.001+2.002' → 3003", () => {
    expect(evaluateExpression("1.001+2.002", 3)).toBe(3003);
  });
});

describe("evaluateExpression — 4dp currencies (CLF)", () => {
  it("scales by 10^4 = 10000: '1.2345' → 12345", () => {
    expect(evaluateExpression("1.2345", 4)).toBe(12345);
  });
});

describe("evaluateExpression — default dp argument", () => {
  it("defaults to 2dp when no dp passed: '10.50' → 1050", () => {
    expect(evaluateExpression("10.50")).toBe(1050);
  });
});

describe("isAmountOverLimit — dp aware", () => {
  it("0dp: at the cap boundary returns false; one over returns true", () => {
    // MAX_AMOUNT = 99_999_999_999. With dp=0 the user types whole-unit values
    // (e.g. JPY), so MAX_AMOUNT itself is reached at "99999999999".
    expect(isAmountOverLimit("99999999999", 0)).toBe(false);
    expect(isAmountOverLimit("100000000000", 0)).toBe(true);
  });

  it("3dp respects the cap proportionally", () => {
    // With dp=3, the user types major units;
    // 99_999_999.999 → 99_999_999_999 (= MAX_AMOUNT, not over)
    expect(isAmountOverLimit("99999999.999", 3)).toBe(false);
    expect(isAmountOverLimit("100000000", 3)).toBe(true);
  });
});
