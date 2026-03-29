import * as XLSX from 'xlsx';
import { db } from '../db/database';
import { notificationService } from './notification.service';

async function exportTransactions(
  startDate: string,
  endDate: string,
  mainCurrency: string,
): Promise<void> {
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
        dataRows.push([
          formatDate(outTx.date),
          outTx.note ?? '',
          '',
          outTx.amountMainCurrency,
          'Transfer',
          account?.name ?? '',
        ]);
      }

      if (inTx) {
        const account = accounts.find((a) => a.id === inTx.accountId);
        dataRows.push([
          formatDate(inTx.date),
          inTx.note ?? '',
          inTx.amountMainCurrency,
          '',
          'Transfer',
          account?.name ?? '',
        ]);
      }
    } else {
      const account = accounts.find((a) => a.id === tx.accountId);
      const category = categories.find((c) => c.id === tx.categoryId);

      const incomeAmount = tx.type === 'INCOME' ? tx.amountMainCurrency : '';
      const expenseAmount = tx.type === 'EXPENSE' ? tx.amountMainCurrency : '';

      dataRows.push([
        formatDate(tx.date),
        tx.note ?? '',
        incomeAmount,
        expenseAmount,
        category?.name ?? 'Transfer',
        account?.name ?? '',
      ]);
    }
  }

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

  notificationService.sendNotification('Export complete', 'Your file has been downloaded.');
}

export const exportService = { exportTransactions };
