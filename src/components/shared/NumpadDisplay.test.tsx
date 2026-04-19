/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NumpadDisplay } from "./NumpadDisplay";

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("NumpadDisplay", () => {
  it("renders formatted value with thousands separator", () => {
    render(<NumpadDisplay value="1000" isActive={false} />);
    expect(screen.getByText(/1 000/)).toBeTruthy();
  });

  it("renders suffix when provided", () => {
    render(<NumpadDisplay value="50" isActive={false} suffix="%" />);
    expect(screen.getByText(/%/)).toBeTruthy();
  });

  it("shows cursor span when isActive=true", () => {
    render(<NumpadDisplay value="100" isActive={true} />);
    const cursor = document.querySelector(".numpad-cursor");
    expect(cursor).not.toBeNull();
  });

  it("hides cursor span when isActive=false", () => {
    render(<NumpadDisplay value="100" isActive={false} />);
    const cursor = document.querySelector(".numpad-cursor");
    expect(cursor).toBeNull();
  });

  it("renders evaluatedDisplay text when provided", () => {
    render(
      <NumpadDisplay value="10+5" isActive={false} evaluatedDisplay="= 15" />
    );
    expect(screen.getByText("= 15")).toBeTruthy();
  });

  it("does not render evaluatedDisplay section when undefined", () => {
    render(<NumpadDisplay value="100" isActive={false} />);
    expect(screen.queryByText(/=/)).toBeNull();
  });

  // TODO e2e — jsdom reports scrollWidth=0 for all elements so the shrink
  // loop never triggers; verify auto-shrink behaviour in a real browser.
  it.skip("auto-shrink: font size drops toward minFontSize when text overflows", () => {
    render(
      <NumpadDisplay
        value="123456789"
        isActive={false}
        maxFontSize={40}
        minFontSize={16}
      />
    );
    const textSpan = document.querySelector("span[style]") as HTMLElement;
    Object.defineProperty(textSpan, "scrollWidth", {
      value: 9999,
      configurable: true,
    });
    // Re-trigger layout effect by forcing a re-render would be needed here;
    // reliable only in a real browser where layout is computed.
    const computedSize = parseInt(textSpan.style.fontSize, 10);
    expect(computedSize).toBeLessThan(40);
  });
});
