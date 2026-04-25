import { describe, it, expect } from "vitest";
import { shouldClearAccountFilter } from "../TransactionFilters";

describe("shouldClearAccountFilter", () => {
  it("returns false when filter is null", () => {
    expect(shouldClearAccountFilter(null, [])).toBe(false);
    expect(shouldClearAccountFilter(null, [{ id: 1 }])).toBe(false);
  });

  it("returns false when accounts is empty (still loading)", () => {
    expect(shouldClearAccountFilter(5, [])).toBe(false);
  });

  it("returns false when the filtered account is still active", () => {
    expect(shouldClearAccountFilter(5, [{ id: 5 }, { id: 6 }])).toBe(false);
  });

  it("returns true when the filtered account is no longer active", () => {
    expect(shouldClearAccountFilter(5, [{ id: 3 }, { id: 6 }])).toBe(true);
  });
});
