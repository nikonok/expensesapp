import { Delete, Calendar, BarChart2 } from "lucide-react";
import { evaluateExpression } from "@/services/math-parser";
import { getCurrencyDecimalPlaces } from "@/utils/currency-utils";

export interface NumpadProps {
  value: string;
  onChange: (v: string) => void;
  onSave: (result: number) => void;
  onCalendarPress?: () => void;
  variant: "transaction" | "budget";
  onStatsPress?: () => void;
  isTransfer?: boolean;
  currencyCode?: string;
}

type KeyDef =
  | { kind: "char"; label: string; char: string; type: "digit" | "operator" }
  | { kind: "backspace" }
  | { kind: "calendar" }
  | { kind: "stats" }
  | { kind: "save" }
  | { kind: "empty" };

const baseKeyStyle: React.CSSProperties = {
  minHeight: "60px",
  borderRadius: "var(--radius-numpad)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  border: "none",
  userSelect: "none",
  WebkitTapHighlightColor: "transparent",
  transition: "transform 80ms ease-out, filter 80ms ease-out",
  fontFamily: '"DM Sans", sans-serif',
  fontSize: "var(--text-body)",
  fontWeight: 500,
};

const digitStyle: React.CSSProperties = {
  ...baseKeyStyle,
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text)",
  fontSize: "1.125rem",
  fontFamily: '"JetBrains Mono", monospace',
  fontWeight: 500,
};

const operatorStyle: React.CSSProperties = {
  ...baseKeyStyle,
  background: "var(--color-surface-raised)",
  color: "var(--color-text-secondary)",
  fontSize: "1.125rem",
  fontFamily: '"JetBrains Mono", monospace',
  fontWeight: 500,
};

const actionStyle: React.CSSProperties = {
  ...baseKeyStyle,
  background: "var(--color-surface-raised)",
  color: "var(--color-text-secondary)",
};

const saveStyle: React.CSSProperties = {
  ...baseKeyStyle,
  background: "var(--color-primary)",
  color: "var(--color-bg)",
  fontFamily: '"Syne", sans-serif',
  fontWeight: 700,
  fontSize: "1rem",
  letterSpacing: "0.05em",
  boxShadow: "0 4px 16px oklch(72% 0.22 210 / 30%)",
  minHeight: "unset",
  height: "100%",
  borderRadius: "var(--radius-numpad)",
};

function useKeyPress() {
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    btn.style.transform = "scale(0.93)";
    btn.style.filter = "brightness(1.25)";
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    btn.style.transform = "";
    btn.style.filter = "";
  };
  return {
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
    onPointerLeave: handlePointerUp,
  };
}

export function Numpad({
  value,
  onChange,
  onSave,
  onCalendarPress,
  variant,
  onStatsPress,
  isTransfer = false,
  currencyCode,
}: NumpadProps) {
  const showOperators = variant === "transaction" && !isTransfer;
  const pressHandlers = useKeyPress();

  const handleChar = (char: string) => {
    if (currencyCode) {
      const dp = getCurrencyDecimalPlaces(currencyCode);
      const segments = value.split(/[+\u2212\-×÷]/);
      const current = segments[segments.length - 1];
      if (char === ".") {
        if (dp === 0) return;
        if (current.includes(".")) return;
      } else if (/^\d$/.test(char) && current.includes(".")) {
        const after = current.split(".")[1] ?? "";
        if (after.length >= dp) return;
      }
    }
    onChange(value + char);
  };

  const handleBackspace = () => {
    onChange(value.slice(0, -1));
  };

  const handleSave = () => {
    if (value === "" || value === "0") {
      onSave(0);
      return;
    }
    const result = evaluateExpression(value);
    if (result === null || isNaN(result)) return;
    onSave(result);
  };

  const cols = showOperators ? 5 : 4;

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: showOperators ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr 1fr",
    gridTemplateRows: "repeat(4, 1fr)",
    gap: "6px",
    padding: "8px",
    width: "100%",
  };

  // Rows [row][col], col 0 = operators (if shown), cols 1-3 = digits A/B/C, col 4 = actions
  // With operators hidden, shift everything left by 1

  const renderKey = (key: KeyDef, row: number, col: number, rowSpan = 1, colSpan = 1) => {
    const gridRow = `${row + 1} / span ${rowSpan}`;
    const gridColumn = `${col + 1} / span ${colSpan}`;
    const style: React.CSSProperties = { gridRow, gridColumn };

    if (key.kind === "empty") {
      return <div key={`empty-${row}-${col}`} style={style} />;
    }

    if (key.kind === "char") {
      const keyStyle = key.type === "operator" ? operatorStyle : digitStyle;
      return (
        <button
          key={`char-${key.char}-${row}`}
          style={{ ...keyStyle, ...style }}
          onClick={() => handleChar(key.char)}
          aria-label={
            key.char === "+"
              ? "add"
              : key.char === "−"
                ? "subtract"
                : key.char === "×"
                  ? "multiply"
                  : key.char === "÷"
                    ? "divide"
                    : key.char === "."
                      ? "decimal point"
                      : key.char
          }
          {...pressHandlers}
        >
          {key.label}
        </button>
      );
    }

    if (key.kind === "backspace") {
      return (
        <button
          key="backspace"
          style={{
            ...actionStyle,
            color: value.length > 0 ? "var(--color-text)" : "var(--color-text-secondary)",
            ...style,
          }}
          onClick={handleBackspace}
          aria-label="backspace"
          {...pressHandlers}
        >
          <Delete size={20} />
        </button>
      );
    }

    if (key.kind === "calendar") {
      return (
        <button
          key="calendar"
          style={{ ...actionStyle, ...style }}
          onClick={onCalendarPress}
          aria-label="pick date"
          {...pressHandlers}
        >
          <Calendar size={20} />
        </button>
      );
    }

    if (key.kind === "stats") {
      return (
        <button
          key="stats"
          style={{ ...actionStyle, ...style }}
          onClick={onStatsPress}
          aria-label="view stats"
          {...pressHandlers}
        >
          <BarChart2 size={20} />
        </button>
      );
    }

    if (key.kind === "save") {
      return (
        <button
          key="save"
          style={{ ...saveStyle, ...style }}
          onClick={handleSave}
          aria-label="save"
          {...pressHandlers}
        >
          SAVE
        </button>
      );
    }

    return null;
  };

  // Layout:
  // Col indices (0-based), with operators:
  //   col 0: operators (+, −, ×, ÷)
  //   col 1: digits A (7, 4, 1, empty)
  //   col 2: digits B (8, 5, 2, 0)
  //   col 3: digits C (9, 6, 3, .)
  //   col 4: actions (⌫, 📅, empty, SAVE spans rows 3+4→ rows 2+3 in 0-idx)
  //
  // Without operators, shift col by -1 (operators col removed).

  const opCol = 0;
  const aCol = showOperators ? 1 : 0;
  const bCol = showOperators ? 2 : 1;
  const cCol = showOperators ? 3 : 2;
  const actCol = showOperators ? 4 : 3;

  return (
    <div style={gridStyle} role="group" aria-label="numpad">
      {/* Operator column */}
      {showOperators && (
        <>
          {renderKey({ kind: "char", label: "+", char: "+", type: "operator" }, 0, opCol)}
          {renderKey({ kind: "char", label: "−", char: "−", type: "operator" }, 1, opCol)}
          {renderKey({ kind: "char", label: "×", char: "×", type: "operator" }, 2, opCol)}
          {renderKey({ kind: "char", label: "÷", char: "÷", type: "operator" }, 3, opCol)}
        </>
      )}

      {/* Digits A column: 7, 4, 1, empty */}
      {renderKey({ kind: "char", label: "7", char: "7", type: "digit" }, 0, aCol)}
      {renderKey({ kind: "char", label: "4", char: "4", type: "digit" }, 1, aCol)}
      {renderKey({ kind: "char", label: "1", char: "1", type: "digit" }, 2, aCol)}
      {renderKey({ kind: "empty" }, 3, aCol)}

      {/* Digits B column: 8, 5, 2, 0 */}
      {renderKey({ kind: "char", label: "8", char: "8", type: "digit" }, 0, bCol)}
      {renderKey({ kind: "char", label: "5", char: "5", type: "digit" }, 1, bCol)}
      {renderKey({ kind: "char", label: "2", char: "2", type: "digit" }, 2, bCol)}
      {renderKey({ kind: "char", label: "0", char: "0", type: "digit" }, 3, bCol)}

      {/* Digits C column: 9, 6, 3, . */}
      {renderKey({ kind: "char", label: "9", char: "9", type: "digit" }, 0, cCol)}
      {renderKey({ kind: "char", label: "6", char: "6", type: "digit" }, 1, cCol)}
      {renderKey({ kind: "char", label: "3", char: "3", type: "digit" }, 2, cCol)}
      {renderKey({ kind: "char", label: ".", char: ".", type: "digit" }, 3, cCol)}

      {/* Actions column: ⌫, 📅/stats, empty, SAVE (spans rows 3+4) */}
      {renderKey({ kind: "backspace" }, 0, actCol)}
      {onStatsPress
        ? renderKey({ kind: "stats" }, 1, actCol)
        : renderKey({ kind: "calendar" }, 1, actCol)}
      {renderKey({ kind: "save" }, 2, actCol, 2)}
    </div>
  );
}
