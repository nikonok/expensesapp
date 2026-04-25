import { useMemo } from "react";
import {
  startOfDay,
  endOfDay,
  differenceInCalendarDays,
  isWithinInterval,
  isBefore,
  isAfter,
} from "date-fns";
import { formatAmount } from "../../utils/currency-utils";
import { getLocalDateString, getWeekRange } from "../../utils/date-utils";
import type { Transaction } from "../../db/models";
import { isExpenseForReporting } from "../../utils/transaction-utils";

interface DailyAveragesProps {
  transactions: Transaction[];
  start: Date;
  end: Date;
  currency: string;
}

interface StatRowProps {
  label: string;
  amount: number;
  currency: string;
}

function StatRow({ label, amount, currency }: StatRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBlock: "var(--space-3)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <span
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 400,
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 500,
          fontSize: "var(--text-amount-sm)",
          color: "var(--color-expense)",
        }}
      >
        {formatAmount(amount, currency)}
      </span>
    </div>
  );
}

export default function DailyAverages({ transactions, start, end, currency }: DailyAveragesProps) {
  const { calendarDays, averagePerDay, todaySpend, thisWeekSpend } = useMemo(() => {
    const expenses = transactions.filter(isExpenseForReporting);
    const totalExpense = expenses.reduce((sum, t) => sum + t.amountMainCurrency, 0);

    // Calendar days in period (inclusive, 1 minimum)
    const calendarDays = Math.max(
      1,
      differenceInCalendarDays(startOfDay(end), startOfDay(start)) + 1,
    );
    const averagePerDay = totalExpense / calendarDays;

    const todayStr = getLocalDateString();
    const todayDate = new Date(todayStr + "T00:00:00");
    const todayInPeriod =
      !isBefore(todayDate, startOfDay(start)) && !isAfter(todayDate, endOfDay(end));

    const todaySpend = todayInPeriod
      ? expenses
          .filter((t) => t.date === todayStr)
          .reduce((sum, t) => sum + t.amountMainCurrency, 0)
      : null;

    const now = new Date();
    const { start: weekStart, end: weekEnd } = getWeekRange(now);
    const periodOverlapsWeek =
      !isAfter(startOfDay(start), endOfDay(weekEnd)) &&
      !isBefore(endOfDay(end), startOfDay(weekStart));

    const thisWeekSpend = periodOverlapsWeek
      ? expenses
          .filter((t) => {
            const txDate = new Date(t.date + "T00:00:00");
            return isWithinInterval(txDate, {
              start: startOfDay(weekStart),
              end: endOfDay(weekEnd),
            });
          })
          .reduce((sum, t) => sum + t.amountMainCurrency, 0)
      : null;

    return { calendarDays, averagePerDay, todaySpend, thisWeekSpend };
  }, [transactions, start, end]);

  return (
    <div style={{ padding: "0 var(--space-4)", paddingBottom: "var(--space-2)" }}>
      <div
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: "var(--text-caption)",
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "var(--space-1)",
        }}
      >
        Daily breakdown
      </div>
      <div>
        <StatRow
          label={`Avg / day (${calendarDays}d)`}
          amount={averagePerDay}
          currency={currency}
        />
        {todaySpend !== null && <StatRow label="Today" amount={todaySpend} currency={currency} />}
        {thisWeekSpend !== null && (
          <StatRow label="This week" amount={thisWeekSpend} currency={currency} />
        )}
      </div>
    </div>
  );
}
