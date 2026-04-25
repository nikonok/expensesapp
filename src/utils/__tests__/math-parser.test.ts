import { describe, it, expect } from "vitest";
import { evaluateExpression } from "../../services/math-parser";

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
