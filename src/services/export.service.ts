import { db } from '../db/database';
import { formatDate } from '../utils/date-utils';
import { isDebtPayment } from '../utils/transaction-utils';
import { logger } from './log.service';

function sanitizeCell(val: unknown): unknown {
  if (typeof val === 'string' && /^[=+@-]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

async function exportTransactions(
  startDate: string,
  endDate: string,
  mainCurrency: string,
): Promise<void> {
  try {
    const allTxs = await db.transactions
      .where('date')
      .between(startDate, endDate, true, true)
      .sortBy('date');
    const transactions = allTxs.filter(tx => tx.isTrashed !== true);

    const [accounts, categories] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
    ]);

    const expenseRows: (string | number)[][] = [];
    const incomeRows: (string | number)[][] = [];

    const emittedTransferGroups = new Set<string>();

    for (const tx of transactions) {
      if (tx.type === 'TRANSFER' && tx.transferGroupId) {
        if (emittedTransferGroups.has(tx.transferGroupId)) {
          continue;
        }
        emittedTransferGroups.add(tx.transferGroupId);

        const partner = transactions.find(
          (t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id,
        );

        const outTx = tx.transferDirection === 'OUT' ? tx : partner;
        const inTx = tx.transferDirection === 'IN' ? tx : partner;

        if (outTx && isDebtPayment(outTx)) {
          const debtAccount = accounts.find((a) => a.id === outTx.toAccountId);
          expenseRows.push([
            sanitizeCell(formatDate(outTx.date)),
            outTx.amountMainCurrency / 100,
            sanitizeCell(outTx.note ?? ''),
            sanitizeCell(debtAccount?.name ?? ''),
          ] as (string | number)[]);
        } else {
          if (outTx && outTx.transferDirection === 'OUT') {
            expenseRows.push([
              sanitizeCell(formatDate(outTx.date)),
              outTx.amountMainCurrency / 100,
              sanitizeCell(outTx.note ?? ''),
              'Transfer',
            ] as (string | number)[]);
          }
          if (inTx && inTx.transferDirection === 'IN') {
            incomeRows.push([
              sanitizeCell(formatDate(inTx.date)),
              inTx.amountMainCurrency / 100,
              sanitizeCell(inTx.note ?? ''),
              'Transfer',
            ] as (string | number)[]);
          }
        }
      } else {
        const category = categories.find((c) => c.id === tx.categoryId);

        if (tx.type === 'EXPENSE') {
          expenseRows.push([
            sanitizeCell(formatDate(tx.date)),
            tx.amountMainCurrency / 100,
            sanitizeCell(tx.note ?? ''),
            sanitizeCell(category?.name ?? ''),
          ] as (string | number)[]);
        } else if (tx.type === 'INCOME') {
          incomeRows.push([
            sanitizeCell(formatDate(tx.date)),
            tx.amountMainCurrency / 100,
            sanitizeCell(tx.note ?? ''),
            sanitizeCell(category?.name ?? ''),
          ] as (string | number)[]);
        }
      }
    }

    const XLSX = await import('xlsx');
    const sheetHeader = ['Date', `Amount (${mainCurrency})`, 'Note', 'Category'];
    const wsExpenses = XLSX.utils.aoa_to_sheet([sheetHeader, ...expenseRows]);
    const wsIncomes = XLSX.utils.aoa_to_sheet([sheetHeader, ...incomeRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');
    XLSX.utils.book_append_sheet(wb, wsIncomes, 'Incomes');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses_${startDate}_to_${endDate}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logger.info('export.complete', { startDate, endDate });
  } catch (err) {
    if (import.meta.env.DEV) console.error('Export failed:', err);
    logger.error('export.failed', err instanceof Error ? err : { message: String(err) });
    throw err;
  }
}

export const exportService = { exportTransactions };
