/* @vitest-environment jsdom */
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../../db/database", () => ({
  db: {
    accounts: {
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(1),
    },
  },
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: (sel: (s: { mainCurrency: string }) => unknown) => sel({ mainCurrency: "USD" }),
}));

vi.mock("../shared/ColorPicker", () => ({
  ColorPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div data-testid="color-picker" onClick={() => onChange(value)} />
  ),
}));

vi.mock("../shared/IconPicker", () => ({
  IconPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div data-testid="icon-picker" onClick={() => onChange(value)} />
  ),
}));

vi.mock("../shared/CurrencyPicker", () => ({
  CurrencyPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button data-testid="currency-picker" onClick={() => onChange(value)}>
      {value}
    </button>
  ),
}));

vi.mock("../shared/Numpad", () => ({
  Numpad: ({
    value,
    onChange,
    onSave,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSave: (v: number) => void;
    variant: string;
  }) => (
    <div data-testid="numpad-mock">
      <span data-testid="numpad-value">{value}</span>
      <button aria-label="numpad-type-5000" onClick={() => onChange("5000")}>
        Type 5000
      </button>
      <button aria-label="numpad-type-2000" onClick={() => onChange("2000")}>
        Type 2000
      </button>
      <button aria-label="numpad-save-5000" onClick={() => onSave(5000)}>
        Save 5000
      </button>
      <button aria-label="numpad-save-2000" onClick={() => onSave(2000)}>
        Save 2000
      </button>
      <button aria-label="numpad-save-3000" onClick={() => onSave(3000)}>
        Save 3000
      </button>
      <button data-testid="numpad-save" onClick={() => onSave(25000)}>
        Save 250
      </button>
    </div>
  ),
}));

vi.mock("../shared/ConfirmDialog", () => ({ ConfirmDialog: () => null }));

vi.mock("../../services/debt-payment.service", () => ({
  calculateMortgagePayment: vi.fn(() => 233837),
}));

vi.mock("../../utils/currency-utils", () => ({
  formatAmount: vi.fn(() => "2 338 USD"),
}));

// ── History mocks for BottomSheet ───────────────────────────────────────────
vi.spyOn(window.history, "pushState").mockImplementation(() => {});
vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

import AccountForm from "./AccountForm";
import type { Account } from "../../db/models";

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderForm(editAccount?: Account) {
  return render(<AccountForm isOpen={true} onClose={vi.fn()} editAccount={editAccount} />);
}

function selectDebtType() {
  fireEvent.click(screen.getByRole("button", { name: "Debt" }));
}

function getDialog() {
  return screen.getByRole("dialog");
}

// ── Numpad seeding and backdrop ────────────────────────────────────────────────

describe("AccountForm — numpad seeding and backdrop", () => {
  let onClose: () => void;

  beforeEach(() => {
    onClose = vi.fn();
    vi.clearAllMocks();
  });

  function renderFormWithClose() {
    return render(<AccountForm isOpen onClose={onClose} />);
  }

  it("starting balance button shows 0.00 before any input", () => {
    renderFormWithClose();
    expect(screen.getByText("0.00")).toBeTruthy();
  });

  it("clicking the balance button opens the numpad overlay", () => {
    renderFormWithClose();
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });
    expect(screen.getByText("Starting Balance (USD)")).toBeTruthy();
  });

  it("numpad receives empty string on first open (no existing value)", () => {
    renderFormWithClose();
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });
    expect(screen.getByTestId("numpad-value").textContent).toBe("");
  });

  it("numpad is seeded with previous value when reopened after saving", () => {
    renderFormWithClose();

    // Open and save 250 via the mock numpad
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("numpad-save"));
    });

    // Balance button now reads "250"; reopen the numpad
    act(() => {
      fireEvent.click(screen.getByText("250"));
    });

    // The numpad should receive "250" as its value (seeded from startingBalance)
    expect(screen.getByTestId("numpad-value").textContent).toBe("250");
  });

  it("backdrop click when numpad is open closes only the numpad, not the form", () => {
    renderFormWithClose();
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });

    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    act(() => {
      fireEvent.click(backdrop);
    });

    expect(screen.queryByText("Starting Balance (USD)")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("backdrop click when numpad is closed closes the whole form", () => {
    renderFormWithClose();

    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    act(() => {
      fireEvent.click(backdrop);
    });

    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── Debt input mode toggle ─────────────────────────────────────────────────────

describe("AccountForm — debt input mode toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to 'original' mode — shows Original Amount input, shows derived Already Paid", () => {
    renderForm();
    selectDebtType();

    const dialog = getDialog();

    const originalBtn = within(dialog).getByRole("button", { name: "Original amount" });
    const alreadyPaidBtn = within(dialog).getByRole("button", { name: "Already paid" });
    expect(originalBtn).toBeTruthy();
    expect(alreadyPaidBtn).toBeTruthy();

    expect(originalBtn.style.background).toBe("var(--color-primary-dim)");
    expect(alreadyPaidBtn.style.background).toBe("var(--color-surface-raised)");

    expect(dialog.textContent).toContain("Already paid:");
    expect(dialog.textContent).toContain("0");
  });

  it("switching to 'alreadyPaid' mode — shows Already Paid input, shows derived Original Amount", () => {
    renderForm();
    selectDebtType();

    const dialog = getDialog();

    const alreadyPaidBtn = within(dialog).getByRole("button", { name: "Already paid" });
    fireEvent.click(alreadyPaidBtn);

    expect(alreadyPaidBtn.style.background).toBe("var(--color-primary-dim)");

    const originalBtn = within(dialog).getByRole("button", { name: "Original amount" });
    expect(originalBtn.style.background).toBe("var(--color-surface-raised)");

    expect(dialog.textContent).toContain("Original amount:");
  });

  it("edit mode shows read-only already-paid derived value and no toggle", () => {
    const mockAccount: Account = {
      id: 1,
      name: "Car Loan",
      type: "DEBT",
      color: "oklch(72% 0.22 210)",
      icon: "car",
      currency: "USD",
      description: "",
      balance: -300000,
      startingBalance: 500000,
      includeInTotal: true,
      isTrashed: false,
      debtOriginalAmount: 500000,
      interestRateYearly: 0.05,
      interestRateMonthly: null,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };

    renderForm(mockAccount);

    const dialog = getDialog();

    const segmentButtons = within(dialog)
      .queryAllByRole("button", { name: /^(Original amount|Already paid)$/ })
      .filter((btn) => btn.textContent === "Original amount" || btn.textContent === "Already paid");
    expect(segmentButtons.length).toBe(0);

    // debtOriginalAmount (5000) - |balance| (3000) = 2000 → formatted as "2 000"
    expect(dialog.textContent).toContain("Already paid:");
    expect(dialog.textContent).toContain("2 000");
  });
});

// ── Mortgage payment preview ──────────────────────────────────────────────────

describe("AccountForm — mortgage payment preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Monthly payment:' preview on create when all mortgage fields are filled", () => {
    renderForm();

    // Select Debt type
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Debt" }));
    });

    // Open debtOriginalAmount numpad and save
    // After selecting Debt, there are 2 "0.00" buttons: starting balance [0] and debtOriginalAmount [1]
    act(() => {
      fireEvent.click(screen.getAllByText("0.00")[1]);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("numpad-save")); // onSave(25000) → "250"
    });

    // Select Mortgage subtype
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Mortgage" }));
    });

    // Open mortgageTermYears numpad and save
    act(() => {
      fireEvent.click(screen.getByText("0 yrs"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("numpad-save")); // "250" yrs
    });

    // Open mortgageInterestRate numpad and save
    act(() => {
      fireEvent.click(screen.getByText("0%"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("numpad-save")); // "250" %
    });

    // Preview should now be visible (calculateMortgagePayment mocked to return 233837)
    const dialog = getDialog();
    expect(dialog.textContent).toContain("Monthly payment:");
    expect(dialog.textContent).toContain("2 338 USD");
  });

  it("shows 'New monthly payment:' label when editing an existing mortgage account", () => {
    const mortgageAccount: Account = {
      id: 5,
      name: "Home Loan",
      type: "DEBT",
      color: "oklch(72% 0.22 210)",
      icon: "home",
      currency: "USD",
      description: "",
      balance: -38000000,
      startingBalance: 40000000,
      includeInTotal: true,
      isTrashed: false,
      savingsGoal: null,
      savingsInterestRate: null,
      interestRateMonthly: null,
      interestRateYearly: null,
      debtOriginalAmount: 40000000,
      mortgageLoanAmount: 40000000,
      mortgageStartDate: "2020-01-01",
      mortgageTermYears: 25,
      mortgageInterestRate: 0.05,
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    renderForm(mortgageAccount);

    // With existing mortgage data, previewPayment should be non-zero immediately
    // (mocked calculateMortgagePayment returns 233837)
    const dialog = getDialog();
    expect(dialog.textContent).toContain("New monthly payment:");
    expect(dialog.textContent).toContain("2 338 USD");
  });
});
