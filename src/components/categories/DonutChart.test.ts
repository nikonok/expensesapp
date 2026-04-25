import { describe, it, expect } from "vitest";
import { formatAmount, dynamicFontSize, computeTextPositions } from "./DonutChart";

describe("formatAmount", () => {
  it("returns integer string for values below 1000", () => {
    expect(formatAmount(99900)).toBe("999");
    expect(formatAmount(4200)).toBe("42");
  });

  it('returns "0" for zero', () => {
    expect(formatAmount(0)).toBe("0");
  });

  it('returns "1.0k" for exactly 1000', () => {
    expect(formatAmount(100000)).toBe("1.0k");
  });

  it("returns formatted thousands string for values in thousands", () => {
    expect(formatAmount(1234500)).toBe("12.3k");
  });

  it("returns formatted millions string for values in millions", () => {
    expect(formatAmount(123456700)).toBe("1.2M");
  });
});

describe("dynamicFontSize", () => {
  it("returns maxSize for an empty string", () => {
    expect(dynamicFontSize("", 24, 14)).toBe(24);
  });

  it("returns maxSize for a short string that fits at max", () => {
    expect(dynamicFontSize("abc", 24, 14)).toBe(24);
  });

  it("returns maxSize for a string exactly at the fits-at-max boundary (8 chars)", () => {
    expect(dynamicFontSize("12345678", 24, 14)).toBe(24);
  });

  it("returns computed size less than maxSize for a string one char beyond boundary (9 chars)", () => {
    expect(dynamicFontSize("123456789", 24, 14)).toBe(22);
  });

  it("returns minSize when computed size would fall below it (15 chars)", () => {
    expect(dynamicFontSize("123456789012345", 24, 14)).toBe(14);
  });
});

describe("computeTextPositions", () => {
  const CY = 100;
  const gap = 4;
  const lineHeightRatio = 1.2;

  it("primaryY equals CY at max sizes (primary=24, secondary=14)", () => {
    const { primaryY } = computeTextPositions(24, 14);
    expect(primaryY).toBe(CY);
  });

  it("primaryY equals CY at min sizes (primary=14, secondary=10)", () => {
    const { primaryY } = computeTextPositions(14, 10);
    expect(primaryY).toBe(CY);
  });

  it("secondaryY is always below CY", () => {
    expect(computeTextPositions(24, 14).secondaryY).toBeGreaterThan(CY);
    expect(computeTextPositions(14, 10).secondaryY).toBeGreaterThan(CY);
  });

  it("gap between bottom-of-primary and top-of-secondary equals 4 at max sizes", () => {
    const { primaryY, secondaryY } = computeTextPositions(24, 14);
    const primaryLineHeight = 24 * lineHeightRatio;
    const secondaryLineHeight = 14 * lineHeightRatio;
    const measuredGap = secondaryY - secondaryLineHeight / 2 - (primaryY + primaryLineHeight / 2);
    expect(measuredGap).toBe(gap);
  });

  it("gap between bottom-of-primary and top-of-secondary equals 4 at min sizes", () => {
    const { primaryY, secondaryY } = computeTextPositions(14, 10);
    const primaryLineHeight = 14 * lineHeightRatio;
    const secondaryLineHeight = 10 * lineHeightRatio;
    const measuredGap = secondaryY - secondaryLineHeight / 2 - (primaryY + primaryLineHeight / 2);
    expect(measuredGap).toBe(gap);
  });
});
