// Cold-recovery entry component (architecture §8.2, Phase 6d).
//
// Renders 24 word inputs with auto-advance on space/word-complete.
// Validates each word against the BIP39 English wordlist.
// On submit, calls back with the validated 24-word phrase.

import { useRef, useState, useCallback } from "react";
import { wordlist } from "@scure/bip39/wordlists/english";

const WORD_COUNT = 24;

/** Set of all valid BIP39 English words (lower-case). */
const BIP39_SET = new Set(wordlist);

export interface RecoveryCodeEntryProps {
  onSubmit: (phrase: string) => void;
  disabled?: boolean;
}

function isValidWord(word: string): boolean {
  return BIP39_SET.has(word.toLowerCase().trim());
}

export function RecoveryCodeEntry({ onSubmit, disabled = false }: RecoveryCodeEntryProps) {
  const [words, setWords] = useState<string[]>(Array(WORD_COUNT).fill(""));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(WORD_COUNT).fill(null));

  const handleWordChange = useCallback((index: number, raw: string) => {
    // Auto-advance on space — trim the space, move to next field.
    const hasTrailingSpace = raw.endsWith(" ");
    const value = raw.trim();

    setWords((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setSubmitError(null);

    if (hasTrailingSpace && value.length > 0) {
      const next = index + 1;
      if (next < WORD_COUNT) {
        inputRefs.current[next]?.focus();
      }
    }
  }, []);

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace on empty → go to previous field.
    if (e.key === "Backspace" && words[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = words.map((w) => w.toLowerCase().trim());

    // All fields filled?
    if (trimmed.some((w) => w === "")) {
      setSubmitError("Please fill in all 24 words.");
      return;
    }

    // All words valid BIP39?
    const invalidIdx = trimmed.findIndex((w) => !isValidWord(w));
    if (invalidIdx !== -1) {
      setSubmitError(
        `Word ${invalidIdx + 1} ("${words[invalidIdx]}") is not a valid recovery word.`,
      );
      inputRefs.current[invalidIdx]?.focus();
      return;
    }

    onSubmit(trimmed.join(" "));
  }

  const allValid = words.every((w) => {
    const trimmed = w.trim();
    return trimmed.length > 0 && isValidWord(trimmed.toLowerCase());
  });

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <p
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-muted)",
          margin: "0 0 var(--space-3)",
          lineHeight: 1.4,
        }}
      >
        Enter your 24-word recovery code in order.
      </p>

      {/* 4-column word grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "var(--space-2)",
          marginBottom: "var(--space-4)",
        }}
      >
        {words.map((word, i) => {
          const isInvalid = word.trim().length > 0 && !isValidWord(word);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-caption)",
                  color: "var(--color-text-disabled)",
                  lineHeight: 1,
                  textAlign: "center",
                }}
              >
                {i + 1}
              </span>
              <input
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={word}
                disabled={disabled}
                onChange={(e) => handleWordChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                style={{
                  background: "var(--color-surface-raised)",
                  border: `1px solid ${isInvalid ? "var(--color-expense)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius-card)",
                  padding: "var(--space-2) var(--space-1)",
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 500,
                  fontSize: "0.65rem",
                  color: "var(--color-text)",
                  textAlign: "center",
                  width: "100%",
                  minHeight: "40px",
                  outline: "none",
                }}
                aria-label={`Word ${i + 1}`}
              />
            </div>
          );
        })}
      </div>

      {submitError && (
        <p
          role="alert"
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-expense)",
            margin: "0 0 var(--space-3)",
          }}
        >
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled || !allValid}
        style={{
          minHeight: "52px",
          width: "100%",
          background:
            allValid && !disabled ? "var(--color-primary)" : "var(--color-surface-raised)",
          color: allValid && !disabled ? "var(--color-bg)" : "var(--color-text-disabled)",
          border: "none",
          borderRadius: "var(--radius-btn)",
          fontFamily: '"Syne", sans-serif',
          fontWeight: 700,
          fontSize: "1rem",
          letterSpacing: "0.05em",
          cursor: allValid && !disabled ? "pointer" : "not-allowed",
          boxShadow: allValid && !disabled ? "0 4px 16px oklch(72% 0.22 210 / 30%)" : "none",
          transition: "background 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out",
        }}
      >
        {disabled ? "Recovering…" : "Restore access"}
      </button>
    </form>
  );
}
