/**
 * Evaluates a simple arithmetic expression with + - × ÷ operators.
 * Follows PEMDAS: × and ÷ are evaluated before + and -.
 * Trailing operator is silently stripped before evaluation.
 * Division by zero returns null (Infinity is treated as invalid input).
 * Returns null for empty or invalid input.
 * Result is an integer in minor currency units.
 *   - For 2-decimal currencies (USD/EUR/etc.) "10.50" → 1050.
 *   - For 0-decimal currencies (JPY) "500" → 500.
 *   - For 3-decimal currencies (KWD/BHD) "10.500" → 10500.
 *
 * `decimalPlaces` defaults to 2 to preserve existing behaviour when a caller
 * does not yet know the source currency.
 */

export const MAX_AMOUNT = 99_999_999_999;

function evaluateRaw(expr: string, decimalPlaces: number): number | null {
  if (!expr || expr.trim() === "") return null;

  const dp = Number.isFinite(decimalPlaces) && decimalPlaces >= 0 ? Math.floor(decimalPlaces) : 2;
  const scale = Math.pow(10, dp);

  // Normalize unicode operators to ASCII
  let normalized = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");

  // Strip trailing operator
  normalized = normalized.replace(/[+\-*/]\s*$/, "");

  if (normalized === "") return null;

  // Tokenize: numbers and operators
  const tokenRegex = /(\d+\.?\d*|\.\d+)|([+\-*/])/g;
  const tokens: Array<{ type: "num"; value: number } | { type: "op"; value: string }> = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(normalized)) !== null) {
    if (match.index !== lastIndex) {
      // Unexpected characters between tokens
      return null;
    }
    if (match[1] !== undefined) {
      tokens.push({ type: "num", value: parseFloat(match[1]) });
    } else {
      tokens.push({ type: "op", value: match[2] });
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex !== normalized.length) return null;
  if (tokens.length === 0) return null;

  // Must start with a number
  if (tokens[0].type !== "num") return null;

  // Must alternate: num op num op num ...
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 0 && tokens[i].type !== "num") return null;
    if (i % 2 === 1 && tokens[i].type !== "op") return null;
  }

  // Must end with a number
  if (tokens[tokens.length - 1].type !== "num") return null;

  // First pass: handle * and /
  const afterMulDiv: Array<{ type: "num"; value: number } | { type: "op"; value: string }> = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "op" && (token.value === "*" || token.value === "/")) {
      const left = afterMulDiv.pop();
      const right = tokens[i + 1];
      if (!left || left.type !== "num" || !right || right.type !== "num") return null;
      let result: number;
      if (token.value === "*") {
        result = left.value * right.value;
      } else {
        result = left.value / right.value;
      }
      // Clamp to the currency's decimal places after each step to prevent float accumulation
      afterMulDiv.push({ type: "num", value: Math.round(result * scale) / scale });
      i += 2;
    } else {
      afterMulDiv.push(token);
      i++;
    }
  }

  // Second pass: handle + and -
  if (afterMulDiv[0].type !== "num") return null;
  let result = (afterMulDiv[0] as { type: "num"; value: number }).value;

  for (let j = 1; j < afterMulDiv.length; j += 2) {
    const op = afterMulDiv[j];
    const right = afterMulDiv[j + 1];
    if (!op || op.type !== "op" || !right || right.type !== "num") return null;
    if (op.value === "+") {
      result = Math.round((result + right.value) * scale) / scale;
    } else if (op.value === "-") {
      result = Math.round((result - right.value) * scale) / scale;
    } else {
      return null;
    }
  }

  const rounded = Math.round(result * scale);
  if (!isFinite(rounded)) return null;
  return rounded;
}

export function evaluateExpression(expr: string, decimalPlaces: number = 2): number | null {
  const raw = evaluateRaw(expr, decimalPlaces);
  if (raw === null || raw < 0 || raw > MAX_AMOUNT) return null;
  return raw;
}

export function isAmountOverLimit(expr: string, decimalPlaces: number = 2): boolean {
  const raw = evaluateRaw(expr, decimalPlaces);
  return raw !== null && raw > MAX_AMOUNT;
}
