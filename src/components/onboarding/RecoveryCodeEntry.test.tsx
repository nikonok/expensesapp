/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecoveryCodeEntry } from "./RecoveryCodeEntry";

// 24 valid BIP39 words from the standard English wordlist that also satisfy
// the full-mnemonic checksum (generated from a fixed all-zero-ish entropy —
// see RecoveryCodeEntry checksum validation).
const VALID_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ready";

// Same 24 words as VALID_PHRASE with the last two transposed — every word is
// still a valid BIP39 wordlist entry, but the checksum encoded across the
// phrase no longer matches (this is the "transposed word" case from the bug
// report: per-word validation alone would let it through).
const TRANSPOSED_INVALID_CHECKSUM_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ready abandon";

describe("RecoveryCodeEntry", () => {
  it("renders 24 word inputs", () => {
    render(<RecoveryCodeEntry onSubmit={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(24);
  });

  it("shows word number labels 1 and 24", () => {
    render(<RecoveryCodeEntry onSubmit={vi.fn()} />);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("24")).toBeTruthy();
  });

  it("submit button is disabled when inputs are empty", () => {
    render(<RecoveryCodeEntry onSubmit={vi.fn()} />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("calls onSubmit with the phrase when all 24 valid words are entered", () => {
    const onSubmit = vi.fn();
    render(<RecoveryCodeEntry onSubmit={onSubmit} />);
    const inputs = screen.getAllByRole("textbox");
    const words = VALID_PHRASE.split(" ");

    words.forEach((word, i) => {
      fireEvent.change(inputs[i], { target: { value: word } });
    });

    const btn = screen.getByRole("button");
    fireEvent.click(btn);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(VALID_PHRASE);
  });

  it("submit button is disabled when a word is not a valid BIP39 word", () => {
    const onSubmit = vi.fn();
    render(<RecoveryCodeEntry onSubmit={onSubmit} />);
    const inputs = screen.getAllByRole("textbox");
    const words = VALID_PHRASE.split(" ");

    // Fill all 24 with valid words first.
    words.forEach((word, i) => {
      fireEvent.change(inputs[i], { target: { value: word } });
    });
    // Override word 1 with an invalid value.
    fireEvent.change(inputs[0], { target: { value: "notaword" } });

    const btn = screen.getByRole("button") as HTMLButtonElement;
    // Button must be disabled — Fix 6: prevent submission of invalid words.
    expect(btn.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows an error when not all 24 words are filled", () => {
    const onSubmit = vi.fn();
    render(<RecoveryCodeEntry onSubmit={onSubmit} />);
    const inputs = screen.getAllByRole("textbox");

    // Fill only the first 10 words.
    VALID_PHRASE.split(" ")
      .slice(0, 10)
      .forEach((word, i) => {
        fireEvent.change(inputs[i], { target: { value: word } });
      });

    const form = inputs[0].closest("form")!;
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent?.toLowerCase()).toContain("all 24");
  });

  it("rejects a transposed-but-wordlist-valid mnemonic with a checksum error and does not call onSubmit", () => {
    const onSubmit = vi.fn();
    render(<RecoveryCodeEntry onSubmit={onSubmit} />);
    const inputs = screen.getAllByRole("textbox");
    const words = TRANSPOSED_INVALID_CHECKSUM_PHRASE.split(" ");

    words.forEach((word, i) => {
      fireEvent.change(inputs[i], { target: { value: word } });
    });

    // Every word is individually valid, so the submit button is enabled —
    // only the full-mnemonic checksum check (run on submit) catches this.
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    const form = inputs[0].closest("form")!;
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
    // react-i18next is not mocked in this file (unlike some other component
    // tests) and falls back to returning the raw key when uninitialized —
    // assert on the key rather than the resolved English copy.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("onboarding.recovery.checksumInvalid");
  });

  it("disables all inputs when disabled=true", () => {
    render(<RecoveryCodeEntry onSubmit={vi.fn()} disabled />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    inputs.forEach((input) => expect(input.disabled).toBe(true));
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("trims trailing space on word input change", () => {
    render(<RecoveryCodeEntry onSubmit={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: "abandon " } });
    expect(inputs[0].value).toBe("abandon");
  });
});
