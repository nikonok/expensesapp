/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AmountDisplay } from "./AmountDisplay";

describe("AmountDisplay", () => {
  it("renders income amount with + prefix", () => {
    render(<AmountDisplay amount={10000} currency="USD" type="income" size="md" />);
    expect(screen.getByText("+")).toBeTruthy();
    expect(screen.getByText("$100.00")).toBeTruthy();
  });

  it("renders expense amount with − prefix", () => {
    render(<AmountDisplay amount={5050} currency="USD" type="expense" size="md" />);
    expect(screen.getByText("−")).toBeTruthy();
    expect(screen.getByText("$50.50")).toBeTruthy();
  });

  it("renders transfer amount with ⇄ prefix", () => {
    render(<AmountDisplay amount={20000} currency="USD" type="transfer" size="md" />);
    expect(screen.getByText("⇄")).toBeTruthy();
    expect(screen.getByText("$200.00")).toBeTruthy();
  });

  it("renders neutral positive amount with no prefix", () => {
    render(<AmountDisplay amount={7500} currency="USD" type="neutral" size="md" />);
    expect(screen.getByText("$75.00")).toBeTruthy();
    // No prefix span rendered when neutral positive
    const prefixSpans = screen
      .queryAllByText(/^\s*[\+\−⇄]\s*$/)
      .filter((el) => el.getAttribute("aria-hidden") === "true");
    expect(prefixSpans.length).toBe(0);
  });

  it("renders neutral negative amount with − prefix and expense color", () => {
    const { container } = render(
      <AmountDisplay amount={-5000} currency="USD" type="neutral" size="md" />,
    );
    expect(screen.getByText("−")).toBeTruthy();
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.color).toBe("var(--color-expense)");
  });

  it("applies income color for income type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="income" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.color).toBe("var(--color-income)");
  });

  it("applies expense color for expense type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="expense" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.color).toBe("var(--color-expense)");
  });

  it("applies transfer color for transfer type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="transfer" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.color).toBe("var(--color-transfer)");
  });

  it("applies neutral text color for neutral positive type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="neutral" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.color).toBe("var(--color-text)");
  });

  it("applies textShadow for income type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="income" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.textShadow).toBeTruthy();
  });

  it("applies textShadow for expense type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="expense" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.textShadow).toBeTruthy();
  });

  it("applies no textShadow for transfer type", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="transfer" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.textShadow).toBe("");
  });

  it("applies lg font size for size lg", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="income" size="lg" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontSize).toBe("var(--text-amount-lg)");
  });

  it("applies md font size for size md", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="income" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontSize).toBe("var(--text-amount-md)");
  });

  it("applies sm font size for size sm", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="income" size="sm" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontSize).toBe("var(--text-amount-sm)");
  });

  it("formats amount using minor units (divides by 100)", () => {
    render(<AmountDisplay amount={123456} currency="USD" type="neutral" size="md" />);
    expect(screen.getByText("$1,234.56")).toBeTruthy();
  });

  it("formats amount in correct currency", () => {
    render(<AmountDisplay amount={10000} currency="EUR" type="income" size="md" />);
    expect(screen.getByText("€100.00")).toBeTruthy();
  });

  it("uses absolute value of amount for display (amount is always shown positive)", () => {
    // Expense type with positive amount internally — amount displayed as absolute value
    render(<AmountDisplay amount={5000} currency="USD" type="expense" size="md" />);
    expect(screen.getByText("$50.00")).toBeTruthy();
  });

  it("applies JetBrains Mono font family", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="neutral" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontFamily).toContain("JetBrains Mono");
  });

  it("has accessible aria-label for income", () => {
    const { container } = render(
      <AmountDisplay amount={10000} currency="USD" type="income" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("income $100.00");
  });

  it("has accessible aria-label for expense", () => {
    const { container } = render(
      <AmountDisplay amount={5050} currency="USD" type="expense" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("expense $50.50");
  });

  it("has accessible aria-label for transfer", () => {
    const { container } = render(
      <AmountDisplay amount={20000} currency="USD" type="transfer" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("transfer $200.00");
  });

  it("has accessible aria-label for neutral positive (no type prefix)", () => {
    const { container } = render(
      <AmountDisplay amount={7500} currency="USD" type="neutral" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("$75.00");
  });

  it("has accessible aria-label for neutral negative", () => {
    const { container } = render(
      <AmountDisplay amount={-5000} currency="USD" type="neutral" size="md" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("negative $50.00");
  });
});
