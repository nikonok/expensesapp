import { db } from '../db/database';
import { notificationService } from './notification.service';

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
  const transactions = await db.transactions
    .where('date')
    .between(startDate, endDate, true, true)
    .sortBy('date');

  const [accounts, categories] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
  ]);

  const headerRow = [
    'Date (dd.mm.yyyy)',
    'Note',
    `Income (${mainCurrency})`,
    `Expense (${mainCurrency})`,
    'Category',
    'Account',
  ];

  const formatDate = (d: string): string => {
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  const dataRows: (string | number)[][] = [];

  // Track which transfer group IDs have been emitted to avoid duplicates
  const emittedTransferGroups = new Set<string>();

  for (const tx of transactions) {
    if (tx.type === 'TRANSFER' && tx.transferGroupId) {
      if (emittedTransferGroups.has(tx.transferGroupId)) {
        continue;
      }
      emittedTransferGroups.add(tx.transferGroupId);

      // Find the partner leg within the fetched transactions
      const partner = transactions.find(
        (t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id,
      );

      const outTx = tx.transferDirection === 'OUT' ? tx : partner;
      const inTx = tx.transferDirection === 'IN' ? tx : partner;

      if (outTx) {
        const account = accounts.find((a) => a.id === outTx.accountId);
        const debtAccount = outTx.toAccountId != null
          ? accounts.find((a) => a.id === outTx.toAccountId)
          : null;
        const categoryLabel = debtAccount ? debtAccount.name : 'Transfer';
        dataRows.push([
          sanitizeCell(formatDate(outTx.date)),
          sanitizeCell(outTx.note ?? ''),
          '',
          outTx.amountMainCurrency,
          sanitizeCell(categoryLabel),
          sanitizeCell(account?.name ?? ''),
        ] as (string | number)[]);
      }

      if (inTx) {
        const account = accounts.find((a) => a.id === inTx.accountId);
        dataRows.push([
          sanitizeCell(formatDate(inTx.date)),
          sanitizeCell(inTx.note ?? ''),
          inTx.amountMainCurrency,
          '',
          'Transfer',
          sanitizeCell(account?.name ?? ''),
        ] as (string | number)[]);
      }
    } else {
      const account = accounts.find((a) => a.id === tx.accountId);
      const category = categories.find((c) => c.id === tx.categoryId);

      const incomeAmount = tx.type === 'INCOME' ? tx.amountMainCurrency : '';
      const expenseAmount = tx.type === 'EXPENSE' ? tx.amountMainCurrency : '';

      dataRows.push([
        sanitizeCell(formatDate(tx.date)),
        sanitizeCell(tx.note ?? ''),
        incomeAmount,
        expenseAmount,
        sanitizeCell(category?.name ?? 'Transfer'),
        sanitizeCell(account?.name ?? ''),
      ] as (string | number)[]);
    }
  }

  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expenses_${startDate}_to_${endDate}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  // TODO: pass translated strings as parameters from the calling component
  notificationService.sendNotification('Export complete', 'Your file has been downloaded.');
  } catch (err) {
    if (import.meta.env.DEV) console.error('Export failed:', err);
    throw err;
  }
}

export const exportService = { exportTransactions };
