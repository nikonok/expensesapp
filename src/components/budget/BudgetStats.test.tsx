/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock useLiveQuery — control return value per test via the module-level variable
let mockStatsResult:
  | { avgMonthly: number | null; lastMonth: number | null; lastBudget: number | null }
  | undefined = undefined;

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (fn: () => unknown) => {
    // Call the fn to satisfy deps tracking, but return the mock result
    void fn;
    return mockStatsResult;
  },
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: (selector: (s: { mainCurrency: string }) => unknown) =>
    selector({ mainCurrency: "USD" }),
}));

vi.mock("../../db/database", () => ({
  db: {
    transactions: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
          filter: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    },
    budgets: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
  },
}));

import { BudgetStats } from "./BudgetStats";

describe("BudgetStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatsResult = undefined;
  });

  it("shows N/A for all rows when stats are loading (undefined)", () => {
    mockStatsResult = undefined;
    render(<BudgetStats categoryId={1} month="2026-04" />);
    const naValues = screen.getAllByText("N/A");
    expect(naValues.length).toBe(3);
  });

  it("shows N/A for all rows when there are no transactions", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    const naValues = screen.getAllByText("N/A");
    expect(naValues.length).toBe(3);
  });

  it('renders "Avg monthly" row label', () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("Avg monthly")).toBeTruthy();
  });

  it('renders "Last set budget" row label', () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("Last set budget")).toBeTruthy();
  });

  it("renders last month label in MM.yyyy format based on the month prop", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    // Previous month of 2026-04 is 2026-03
    expect(screen.getByText("Last month (03.2026)")).toBeTruthy();
  });

  it("renders last month label correctly when month is January (wraps to previous year)", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-01" />);
    // Previous month of 2026-01 is 2025-12
    expect(screen.getByText("Last month (12.2025)")).toBeTruthy();
  });

  it("shows formatted avgMonthly when present", () => {
    mockStatsResult = { avgMonthly: 50000, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("$500.00")).toBeTruthy();
  });

  it("shows formatted lastMonth when present", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: 123456, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("$1,234.56")).toBeTruthy();
  });

  it("shows formatted lastBudget when present", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: 75000 };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("$750.00")).toBeTruthy();
  });

  it("shows all three formatted values when all stats are present", () => {
    mockStatsResult = { avgMonthly: 10000, lastMonth: 20000, lastBudget: 30000 };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("$100.00")).toBeTruthy();
    expect(screen.getByText("$200.00")).toBeTruthy();
    expect(screen.getByText("$300.00")).toBeTruthy();
  });

  it("applies disabled color to N/A values", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    const { container } = render(<BudgetStats categoryId={1} month="2026-04" />);
    const naSpans = Array.from(container.querySelectorAll("span")).filter(
      (el) => el.textContent === "N/A",
    ) as HTMLElement[];
    expect(naSpans.length).toBe(3);
    naSpans.forEach((span) => {
      expect(span.style.color).toBe("var(--color-text-disabled)");
    });
  });

  it("applies regular text color to non-N/A values", () => {
    mockStatsResult = { avgMonthly: 10000, lastMonth: null, lastBudget: null };
    const { container } = render(<BudgetStats categoryId={1} month="2026-04" />);
    const valueSpan = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "$100.00",
    ) as HTMLElement;
    expect(valueSpan).toBeTruthy();
    expect(valueSpan.style.color).toBe("var(--color-text)");
  });

  it("works with accountId prop instead of categoryId", () => {
    mockStatsResult = { avgMonthly: 5000, lastMonth: null, lastBudget: null };
    render(<BudgetStats accountId={7} month="2026-04" />);
    expect(screen.getByText("$50.00")).toBeTruthy();
  });

  it("renders three rows", () => {
    mockStatsResult = { avgMonthly: null, lastMonth: null, lastBudget: null };
    render(<BudgetStats categoryId={1} month="2026-04" />);
    expect(screen.getByText("Avg monthly")).toBeTruthy();
    expect(screen.getByText(/^Last month/)).toBeTruthy();
    expect(screen.getByText("Last set budget")).toBeTruthy();
  });
});
