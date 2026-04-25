/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { db } from "../../db/database";
import { BudgetNumpad } from "./BudgetNumpad";

vi.mock("../../db/database", () => ({
  db: {
    budgets: {
      where: vi.fn(),
      update: vi.fn().mockResolvedValue(1),
      add: vi.fn().mockResolvedValue(1),
    },
  },
}));

vi.mock("../shared/Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock("./BudgetStats", () => ({
  BudgetStats: () => null,
}));

vi.mock("../layout/BottomSheet", () => ({
  default: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <>{children}</> : null,
}));

vi.mock("../shared/Numpad", () => ({
  Numpad: ({
    value,
    onSave,
  }: {
    value: string;
    onSave: (n: number) => void;
    onChange: (v: string) => void;
    variant?: string;
    onStatsPress?: () => void;
  }) => (
    <div>
      <span data-testid="numpad-display">{value}</span>
      <button onClick={() => onSave(50000)}>save</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.budgets.where).mockReturnValue({
    equals: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
    }),
  } as any);
  vi.mocked(db.budgets.add).mockResolvedValue(1);
  vi.mocked(db.budgets.update).mockResolvedValue(1);
});

describe("BudgetNumpad", () => {
  it("initialises numpad with currentPlanned divided by 100", () => {
    render(
      <BudgetNumpad
        categoryId={1}
        currentMonth="2026-04"
        currentPlanned={1050}
        itemName="Food"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("numpad-display").textContent).toBe("10.5");
  });

  it("initialises numpad with empty string when currentPlanned is 0", () => {
    render(
      <BudgetNumpad
        categoryId={1}
        currentMonth="2026-04"
        currentPlanned={0}
        itemName="Food"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("numpad-display").textContent).toBe("");
  });

  it("initialises numpad with empty string when currentPlanned is undefined", () => {
    render(
      <BudgetNumpad categoryId={1} currentMonth="2026-04" itemName="Food" onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("numpad-display").textContent).toBe("");
  });

  it("calls db.budgets.add and onClose when no existing budget", async () => {
    const onClose = vi.fn();
    render(
      <BudgetNumpad categoryId={1} currentMonth="2026-04" itemName="Food" onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(db.budgets.add)).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 1, plannedAmount: 50000 }),
    );
    expect(vi.mocked(db.budgets.update)).not.toHaveBeenCalled();
  });

  it("calls db.budgets.update when budget already exists", async () => {
    vi.mocked(db.budgets.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ id: 42, plannedAmount: 1000 }),
      }),
    } as any);
    const onClose = vi.fn();
    render(
      <BudgetNumpad categoryId={1} currentMonth="2026-04" itemName="Food" onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(db.budgets.update)).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ plannedAmount: 50000 }),
    );
    expect(vi.mocked(db.budgets.add)).not.toHaveBeenCalled();
  });

  it("queries by accountId when categoryId is not provided", async () => {
    const onClose = vi.fn();
    render(
      <BudgetNumpad accountId={7} currentMonth="2026-04" itemName="Savings" onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(db.budgets.where)).toHaveBeenCalledWith("[accountId+month]");
  });

  it("queries by categoryId when categoryId is provided", async () => {
    const onClose = vi.fn();
    render(
      <BudgetNumpad categoryId={3} currentMonth="2026-04" itemName="Transport" onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(db.budgets.where)).toHaveBeenCalledWith("[categoryId+month]");
  });
});
