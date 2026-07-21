import { useTotalBalance } from "../../hooks/use-total-balance";

export function cellFontSize(str: string): string {
  if (str.length > 13) return "var(--text-caption)";
  if (str.length > 10) return "var(--text-amount-sm)";
  return "var(--text-body)";
}

export default function TotalWealth() {
  const { mainCurrency, ratesAvailable, groups, grandAssets, grandDebts, netWorth } =
    useTotalBalance();

  if (groups.length === 0) return null;

  const formatAmount = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount) / 100);

  return (
    <div
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        marginBottom: "var(--space-4)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Currency
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-caption)",
            color: "var(--color-income)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            textAlign: "right",
          }}
        >
          Assets
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-caption)",
            color: "var(--color-expense)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            textAlign: "right",
          }}
        >
          Debts
        </span>
      </div>

      {/* Currency rows */}
      {groups.map((g) => {
        const assetsStr = formatAmount(g.assets, g.currency);
        const debtsStr = formatAmount(g.debts, g.currency);
        return (
          <div
            key={g.currency}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              padding: "var(--space-2) var(--space-4)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: "var(--text-body)",
                color: "var(--color-text)",
              }}
            >
              {g.currency}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: cellFontSize(assetsStr),
                color:
                  g.assets < 0
                    ? "var(--color-expense)"
                    : g.assets > 0
                      ? "var(--color-income)"
                      : "var(--color-text-secondary)",
                textAlign: "right",
              }}
            >
              {g.assets < 0 ? "\u2212" : ""}
              {assetsStr}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: g.debts > 0 ? cellFontSize(debtsStr) : "var(--text-body)",
                color: g.debts > 0 ? "var(--color-expense)" : "var(--color-text-secondary)",
                textAlign: "right",
              }}
            >
              {g.debts > 0 ? debtsStr : "—"}
            </span>
          </div>
        );
      })}

      {/* Grand total unavailable — shown only when rates were checked and found missing, not during initial load */}
      {!ratesAvailable && groups.some((g) => g.currency !== mainCurrency) && (
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "var(--color-surface-raised)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 700,
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
              flex: 1,
            }}
          >
            Net
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              color: "var(--color-text-secondary)",
            }}
          >
            —
          </span>
        </div>
      )}

      {/* Grand total row */}
      {grandAssets != null && grandDebts != null && (
        <div
          role="status"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--color-surface-raised)",
          }}
        >
          <span
            style={
              {
                fontFamily: '"Syne", sans-serif',
                fontWeight: 700,
                fontSize: "var(--text-body)",
                color: "var(--color-text)",
              } as React.CSSProperties
            }
          >
            Net
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: cellFontSize(formatAmount(grandAssets, mainCurrency)),
              color:
                grandAssets < 0
                  ? "var(--color-expense)"
                  : grandAssets > 0
                    ? "var(--color-income)"
                    : "var(--color-text-secondary)",
              textAlign: "right",
            }}
          >
            {grandAssets < 0 ? "\u2212" : ""}
            {formatAmount(grandAssets, mainCurrency)}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize:
                netWorth != null
                  ? cellFontSize(formatAmount(netWorth, mainCurrency))
                  : "var(--text-body)",
              color:
                netWorth != null && netWorth >= 0 ? "var(--color-income)" : "var(--color-expense)",
              textAlign: "right",
            }}
          >
            {netWorth != null
              ? (netWorth < 0 ? "\u2212" : "") + formatAmount(netWorth, mainCurrency)
              : "…"}
          </span>
        </div>
      )}
    </div>
  );
}
