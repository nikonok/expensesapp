import type { Transaction } from "../db/models";

export function isDebtPayment(tx: Transaction): boolean {
  return tx.type === "TRANSFER" && tx.transferDirection === "OUT" && tx.toAccountId != null;
}

export function isExpenseForReporting(tx: Transaction): boolean {
  return tx.type === "EXPENSE" || isDebtPayment(tx);
}

export function getDayTotals(txs: Transaction[]): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === "INCOME") income += t.amountMainCurrency;
    else if (isExpenseForReporting(t)) expense += t.amountMainCurrency;
  }
  return { income, expense };
}
