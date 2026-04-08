import type { Transaction } from '../db/models';

export function isDebtPayment(tx: Transaction): boolean {
  return (
    tx.type === 'TRANSFER' &&
    tx.transferDirection === 'OUT' &&
    tx.toAccountId != null
  );
}

export function isExpenseForReporting(tx: Transaction): boolean {
  return tx.type === 'EXPENSE' || isDebtPayment(tx);
}
