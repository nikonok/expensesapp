/* @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Numpad } from "./Numpad";

describe("Numpad", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onChange: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onSave: any;

  beforeEach(() => {
    onChange = vi.fn();
    onSave = vi.fn();
  });

  function renderNumpad(value = "") {
    return render(
      <Numpad
        value={value}
        onChange={onChange}
        onSave={onSave}
        variant="transaction"
      />
    );
  }

  it("pressing 1, 0, 0 calls onChange with accumulated string", () => {
    const { rerender } = renderNumpad("");

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(onChange).toHaveBeenLastCalledWith("1");

    rerender(
      <Numpad value="1" onChange={onChange} onSave={onSave} variant="transaction" />
    );
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith("10");

    rerender(
      <Numpad value="10" onChange={onChange} onSave={onSave} variant="transaction" />
    );
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith("100");
  });

  it("pressing backspace calls onChange removing last char", () => {
    renderNumpad("100");
    fireEvent.click(screen.getByRole("button", { name: "backspace" }));
    expect(onChange).toHaveBeenCalledWith("10");
  });

  it("pressing save with value '100' calls onSave(100)", () => {
    renderNumpad("100");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(100);
  });

  it("trailing operator is stripped: value '100+' → onSave(100)", () => {
    renderNumpad("100+");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(100);
  });

  it("PEMDAS: value '10×5+2' → onSave(52)", () => {
    renderNumpad("10×5+2");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith(52);
  });

  it("does not call onSave when expression is invalid", () => {
    renderNumpad("");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
