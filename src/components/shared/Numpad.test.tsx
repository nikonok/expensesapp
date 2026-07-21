/* @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Numpad } from "./Numpad";
import { ToastProvider } from "./Toast";

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("Numpad", () => {
   
  let onChange: any;
   
  let onSave: any;

  beforeEach(() => {
    onChange = vi.fn();
    onSave = vi.fn();
  });

  function renderNumpad(value = "") {
    return renderWithToast(
      <Numpad value={value} onChange={onChange} onSave={onSave} variant="transaction" />,
    );
  }

  it("pressing 1, 0, 0 calls onChange with accumulated string", () => {
    const { rerender } = renderNumpad("");

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(onChange).toHaveBeenLastCalledWith("1");

    rerender(
      <ToastProvider>
        <Numpad value="1" onChange={onChange} onSave={onSave} variant="transaction" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith("10");

    rerender(
      <ToastProvider>
        <Numpad value="10" onChange={onChange} onSave={onSave} variant="transaction" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith("100");
  });

  it("pressing backspace calls onChange removing last char", () => {
    renderNumpad("100");
    fireEvent.click(screen.getByRole("button", { name: "backspace" }));
    expect(onChange).toHaveBeenCalledWith("10");
  });

  it("pressing save with value '100' calls onSave(10000)", () => {
    renderNumpad("100");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(10000);
  });

  it("trailing operator is stripped: value '100+' → onSave(10000)", () => {
    renderNumpad("100+");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(10000);
  });

  it("PEMDAS: value '10×5+2' → onSave(5200)", () => {
    renderNumpad("10×5+2");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(5200);
  });

  it("pressing save with empty value calls onSave(0) to allow zero-balance accounts", () => {
    renderNumpad("");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(0);
  });

  it("pressing save with value '0' calls onSave(0)", () => {
    renderNumpad("0");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(0);
  });

  it("uses the uniform ×100 storage scale even for a 0-decimal currency like JPY", () => {
    // Per the app-wide uniform minor-unit convention, saving must always
    // scale by 100 regardless of the currency's native decimal places —
    // JPY "500" must save as 50000, not 500.
    renderWithToast(
      <Numpad
        value="500"
        onChange={onChange}
        onSave={onSave}
        variant="transaction"
        currencyCode="JPY"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(50000);
  });

  it("uses the uniform ×100 storage scale even for a 3-decimal currency like KWD", () => {
    renderWithToast(
      <Numpad
        value="10.123"
        onChange={onChange}
        onSave={onSave}
        variant="transaction"
        currencyCode="KWD"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    // Uniform ×100 scale: 10.123 * 100 rounded = 1012 (the guard already
    // prevents typing a 3rd decimal digit in the general case, but the
    // evaluation itself must not special-case KWD's native 3dp).
    expect(onSave).toHaveBeenCalledWith(1012);
  });

  it("subtraction using the numpad's U+2212 minus key evaluates correctly", () => {
    renderNumpad("200−75");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(12500);
  });

  it("backspace button looks dim when value is empty", () => {
    renderNumpad("");
    const btn = screen.getByRole("button", { name: "backspace" });
    expect(btn.style.color).toBe("var(--color-text-secondary)");
  });

  it("backspace button looks active when value has content", () => {
    renderNumpad("123");
    const btn = screen.getByRole("button", { name: "backspace" });
    expect(btn.style.color).toBe("var(--color-text)");
  });

  describe("decimal guards", () => {
    it("JPY blocks decimal point", () => {
      renderWithToast(
        <Numpad
          value=""
          onChange={onChange}
          onSave={vi.fn()}
          variant="transaction"
          currencyCode="JPY"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "decimal point" }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("USD blocks second decimal point in same segment", () => {
      renderWithToast(
        <Numpad
          value="1."
          onChange={onChange}
          onSave={vi.fn()}
          variant="transaction"
          currencyCode="USD"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "decimal point" }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("USD blocks 3rd decimal digit", () => {
      renderWithToast(
        <Numpad
          value="1.23"
          onChange={onChange}
          onSave={vi.fn()}
          variant="transaction"
          currencyCode="USD"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "4" }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("KWD allows 3rd decimal digit", () => {
      renderWithToast(
        <Numpad
          value="1.23"
          onChange={onChange}
          onSave={vi.fn()}
          variant="transaction"
          currencyCode="KWD"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "4" }));
      expect(onChange).toHaveBeenCalledWith("1.234");
    });

    it("KWD blocks 4th decimal digit", () => {
      renderWithToast(
        <Numpad
          value="1.234"
          onChange={onChange}
          onSave={vi.fn()}
          variant="transaction"
          currencyCode="KWD"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "5" }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("multi-segment: new segment after operator resets decimal tracking", () => {
      renderWithToast(
        <Numpad
          value="1.23+4"
          onChange={onChange}
          onSave={vi.fn()}
          variant="transaction"
          currencyCode="USD"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "decimal point" }));
      expect(onChange).toHaveBeenCalledWith("1.23+4.");
    });

    it("no currencyCode: all digits pass through without guard", () => {
      renderWithToast(
        <Numpad value="1.234567" onChange={onChange} onSave={vi.fn()} variant="transaction" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "8" }));
      expect(onChange).toHaveBeenCalledWith("1.2345678");
    });
  });

  it("shows toast and does not call onSave when amount exceeds MAX_AMOUNT", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    // value that evaluates to > 99_999_999_999 minor units (e.g. 9999999999.01 dollars = 999,999,999,901 cents)
    renderWithToast(
      <Numpad value="9999999999.01" onChange={onChange} onSave={onSave} variant="transaction" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    // Toast renders with role="status" — getByRole throws if absent
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
