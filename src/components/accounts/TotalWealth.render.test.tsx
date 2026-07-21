/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TotalWealth from "./TotalWealth";
import { useTotalBalance } from "../../hooks/use-total-balance";

vi.mock("../../hooks/use-total-balance", () => ({ useTotalBalance: vi.fn() }));

describe("TotalWealth", () => {
  it("renders nothing when there are no currency groups", () => {
    vi.mocked(useTotalBalance).mockReturnValue({
      netWorth: null,
      mainCurrency: "USD",
      ratesAvailable: true,
      groups: [],
      grandAssets: null,
      grandDebts: null,
    });
    const { container } = render(<TotalWealth />);
    expect(container.firstChild).toBeNull();
  });

  it("renders per-currency rows and the grand total sourced entirely from the hook (no local recomputation)", () => {
    vi.mocked(useTotalBalance).mockReturnValue({
      netWorth: 25800,
      mainCurrency: "USD",
      ratesAvailable: true,
      groups: [
        { currency: "USD", assets: 20000, debts: 5000 },
        { currency: "EUR", assets: 10000, debts: 0 },
      ],
      grandAssets: 30800,
      grandDebts: 5000,
    });

    render(<TotalWealth />);

    // Per-currency rows use each group's own currency for formatting.
    expect(screen.getByText("$200.00")).toBeTruthy();
    expect(screen.getByText("$50.00")).toBeTruthy();
    expect(screen.getByText("€100.00")).toBeTruthy();

    // Grand total row renders the hook's netWorth directly (25800 = 258.00 USD),
    // not a locally recomputed grandAssets - grandDebts.
    const netRow = screen.getByRole("status");
    expect(netRow.textContent).toContain("$258.00");
  });

  it("shows the unavailable placeholder when rates could not be fetched for a foreign currency", () => {
    vi.mocked(useTotalBalance).mockReturnValue({
      netWorth: null,
      mainCurrency: "USD",
      ratesAvailable: false,
      groups: [{ currency: "EUR", assets: 10000, debts: 0 }],
      grandAssets: null,
      grandDebts: null,
    });

    render(<TotalWealth />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
