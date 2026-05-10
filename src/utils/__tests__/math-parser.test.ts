import { describe, it, expect } from "vitest";
import { evaluateExpression, isAmountOverLimit, MAX_AMOUNT } from "../../services/math-parser";

describe("evaluateExpression", () => {
  it("returns null for empty string", () => {
    expect(evaluateExpression("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(evaluateExpression("   ")).toBeNull();
  });

  it("evaluates simple addition", () => {
    expect(evaluateExpression("100+50")).toBe(15000);
  });

  it("evaluates unicode multiply before addition (PEMDAS)", () => {
    expect(evaluateExpression("10×5+2")).toBe(5200);
  });

  it("evaluates unicode division", () => {
    expect(evaluateExpression("100÷4")).toBe(2500);
  });

  it("strips trailing operator", () => {
    expect(evaluateExpression("100+")).toBe(10000);
  });

  it("strips trailing unicode operator", () => {
    expect(evaluateExpression("50×")).toBe(5000);
  });

  it("evaluates a single number", () => {
    expect(evaluateExpression("42")).toBe(4200);
  });

  it("evaluates subtraction", () => {
    expect(evaluateExpression("200-75")).toBe(12500);
  });

  it("respects PEMDAS: multiply before add", () => {
    expect(evaluateExpression("2+3×4")).toBe(1400);
  });

  it("respects PEMDAS: divide before subtract", () => {
    expect(evaluateExpression("10-6÷3")).toBe(800);
  });

  it("rounds to nearest cent (integer minor units)", () => {
    expect(evaluateExpression("1÷3")).toBe(33);
  });

  it("evaluates chained operations", () => {
    expect(evaluateExpression("10+20+30")).toBe(6000);
  });

  it("returns null for invalid expression", () => {
    expect(evaluateExpression("abc")).toBeNull();
  });

  it("returns null for expression starting with operator", () => {
    expect(evaluateExpression("+5")).toBeNull();
  });

  /**
   * Division by zero returns null (spec §6.3: invalid input must return null).
   * Infinity is not a valid number for balance calculations.
   */
  it("division by zero returns null", () => {
    expect(evaluateExpression("5÷0")).toBeNull();
  });
});

describe("evaluateExpression — cap behavior", () => {
  it("returns null when result exceeds MAX_AMOUNT", () => {
    // any expression that evaluates well above the cap
    expect(evaluateExpression("9999999999.01")).toBeNull();
  });

  it("returns null for negative results", () => {
    expect(evaluateExpression("5-10")).toBeNull();
  });

  it("accepts result exactly at the cap boundary", () => {
    // 999999999.99 * 100 = 99999999999 = MAX_AMOUNT
    expect(evaluateExpression("999999999.99")).toBe(99_999_999_999);
  });
});

describe("isAmountOverLimit", () => {
  it("returns true when result exceeds MAX_AMOUNT", () => {
    expect(isAmountOverLimit("9999999999.01")).toBe(true);
  });

  it("returns false at the cap boundary", () => {
    expect(isAmountOverLimit("999999999.99")).toBe(false);
  });

  it("returns false for partial expression with trailing operator", () => {
    expect(isAmountOverLimit("5+")).toBe(false);
  });

  it("returns false for invalid syntax", () => {
    expect(isAmountOverLimit("abc")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAmountOverLimit("")).toBe(false);
  });

  it("returns false for division by zero", () => {
    expect(isAmountOverLimit("5÷0")).toBe(false);
  });

  it("returns false for negative results (cap is upper-bound only)", () => {
    expect(isAmountOverLimit("5-10")).toBe(false);
  });
});

// Ensure MAX_AMOUNT is exported with the expected value
describe("MAX_AMOUNT", () => {
  it("equals 99_999_999_999", () => {
    expect(MAX_AMOUNT).toBe(99_999_999_999);
  });
});
