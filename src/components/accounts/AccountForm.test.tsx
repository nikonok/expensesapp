/* @vitest-environment jsdom */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AccountForm from "./AccountForm";

// ── Dependency mocks ────────────────────────────────────────────────────────
vi.mock("../../db/database", () => ({
  db: {
    accounts: {
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(1),
    },
  },
}));
vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: (sel: (s: { mainCurrency: string }) => unknown) =>
    sel({ mainCurrency: "USD" }),
}));
// Stub sub-components not under test
vi.mock("../shared/ColorPicker", () => ({ ColorPicker: () => null }));
vi.mock("../shared/IconPicker", () => ({ IconPicker: () => null }));
vi.mock("../shared/CurrencyPicker", () => ({ CurrencyPicker: () => null }));
vi.mock("../shared/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
// Numpad mock: renders the value prop and exposes a save trigger
vi.mock("../shared/Numpad", () => ({
  Numpad: ({
    value,
    onSave,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSave: (v: number) => void;
    variant: string;
  }) => (
    <div>
      <span data-testid="numpad-value">{value}</span>
      <button data-testid="numpad-save" onClick={() => onSave(250)}>
        Save
      </button>
    </div>
  ),
}));

// ── History mocks for BottomSheet ───────────────────────────────────────────
vi.spyOn(window.history, "pushState").mockImplementation(() => {});
vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

describe("AccountForm — numpad seeding and backdrop", () => {
  let onClose: () => void;

  beforeEach(() => {
    onClose = vi.fn();
  });

  function renderForm() {
    return render(<AccountForm isOpen onClose={onClose} />);
  }

  it("starting balance button shows 0.00 before any input", () => {
    renderForm();
    expect(screen.getByText("0.00")).toBeTruthy();
  });

  it("clicking the balance button opens the numpad overlay", () => {
    renderForm();
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });
    expect(screen.getByText("Starting Balance (USD)")).toBeTruthy();
  });

  it("numpad receives empty string on first open (no existing value)", () => {
    renderForm();
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });
    expect(screen.getByTestId("numpad-value").textContent).toBe("");
  });

  it("numpad is seeded with previous value when reopened after saving", () => {
    renderForm();

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
    renderForm();
    act(() => {
      fireEvent.click(screen.getByText("0.00"));
    });

    // The BottomSheet backdrop is rendered in a portal
    const backdrop = document.body.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    act(() => {
      fireEvent.click(backdrop);
    });

    // Numpad overlay should be gone
    expect(screen.queryByText("Starting Balance (USD)")).toBeNull();
    // Form's onClose was NOT called
    expect(onClose).not.toHaveBeenCalled();
  });

  it("backdrop click when numpad is closed closes the whole form", () => {
    renderForm();

    const backdrop = document.body.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    act(() => {
      fireEvent.click(backdrop);
    });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
