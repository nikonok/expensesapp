import { describe, it, expect } from "vitest";
import { isCurrentPeriod } from "../PeriodFilter";
import type { PeriodFilter } from "../../../types";
import { format, addMonths, subMonths } from "date-fns";

describe("isCurrentPeriod", () => {
  it("returns true for month filter containing today", () => {
    const now = new Date();
    const filter: PeriodFilter = {
      type: "month",
      startDate: format(now, "yyyy-MM-dd"),
      endDate: format(now, "yyyy-MM-dd"),
    };
    expect(isCurrentPeriod(filter)).toBe(true);
  });

  it("returns false for month filter in the past", () => {
    const pastMonth = subMonths(new Date(), 2);
    const filter: PeriodFilter = {
      type: "month",
      startDate: format(pastMonth, "yyyy-MM-dd"),
      endDate: format(pastMonth, "yyyy-MM-dd"),
    };
    expect(isCurrentPeriod(filter)).toBe(false);
  });

  it("returns false for month filter in the future", () => {
    const futureMonth = addMonths(new Date(), 2);
    const filter: PeriodFilter = {
      type: "month",
      startDate: format(futureMonth, "yyyy-MM-dd"),
      endDate: format(futureMonth, "yyyy-MM-dd"),
    };
    expect(isCurrentPeriod(filter)).toBe(false);
  });

  it("returns true for today filter type", () => {
    const now = new Date();
    const filter: PeriodFilter = {
      type: "today",
      startDate: format(now, "yyyy-MM-dd"),
      endDate: format(now, "yyyy-MM-dd"),
    };
    expect(isCurrentPeriod(filter)).toBe(true);
  });

  it("returns false for non-navigable types (all)", () => {
    const filter: PeriodFilter = {
      type: "all",
      startDate: "2000-01-01",
      endDate: "2099-12-31",
    };
    expect(isCurrentPeriod(filter)).toBe(false);
  });

  it("returns false for non-navigable types (custom)", () => {
    const now = new Date();
    const filter: PeriodFilter = {
      type: "custom",
      startDate: format(now, "yyyy-MM-dd"),
      endDate: format(now, "yyyy-MM-dd"),
    };
    expect(isCurrentPeriod(filter)).toBe(false);
  });
});
