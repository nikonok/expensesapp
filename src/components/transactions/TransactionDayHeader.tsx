import { parseISO, format } from "date-fns";
import { AmountDisplay } from "../shared/AmountDisplay";

interface TransactionDayHeaderProps {
  date: string;
  totalIncome: number;
  totalExpense: number;
  currency: string;
}

export default function TransactionDayHeader({
  date,
  totalIncome,
  totalExpense,
  currency,
}: TransactionDayHeaderProps) {
  const parsed = parseISO(date);
  const dayNum = format(parsed, "d");
  const dayLabel = format(parsed, "EEE, dd.MM.yyyy");

  return (
    <div
      style={{
        position: "sticky",
        top: "61px" /* PeriodFilter row height */,
        zIndex: "var(--z-sticky)",
        background: "var(--color-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingInline: "var(--space-4)",
        paddingTop: "var(--space-2)",
        paddingBottom: "var(--space-2)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Left: day number + label */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
        <span
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-day-num)",
            color: "var(--color-text)",
            lineHeight: 1,
          }}
        >
          {dayNum}
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 400,
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
          }}
        >
          {dayLabel}
        </span>
      </div>

      {/* Right: income + expense totals */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {totalIncome > 0 && (
          <AmountDisplay amount={totalIncome} currency={currency} type="income" size="sm" />
        )}
        {totalExpense > 0 && (
          <AmountDisplay amount={totalExpense} currency={currency} type="expense" size="sm" />
        )}
      </div>
    </div>
  );
}
