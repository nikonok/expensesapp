import { db } from '@/db/database';
import type { Account, Transaction } from '@/db/models';

export class QuotaError extends Error {
  name = 'QuotaError';
  constructor(message = 'Storage quota exceeded') {
    super(message);
  }
}

function wrapQuotaError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new QuotaError();
    }
    throw err;
  });
}

function getBalanceDelta(account: Account, tx: Transaction): number {
  if (tx.type === 'INCOME') {
    return account.type === 'DEBT' ? -tx.amount : tx.amount;
  }
  if (tx.type === 'EXPENSE') {
    return account.type === 'DEBT' ? tx.amount : -tx.amount;
  }
  // TRANSFER
  if (tx.transferDirection === 'IN') {
    return account.type === 'DEBT' ? -tx.amount : tx.amount;
  }
  // TRANSFER OUT
  return account.type === 'DEBT' ? tx.amount : -tx.amount;
}

async function getMinDisplayOrder(date: string): Promise<number> {
  const existing = await db.transactions
    .where('date')
    .equals(date)
    .toArray();
  if (existing.length === 0) return 1;
  return Math.min(...existing.map((t) => t.displayOrder));
}

export async function applyTransaction(tx: Transaction): Promise<void> {
  return wrapQuotaError(
    db.transaction('rw', [db.accounts, db.transactions], async () => {
      const account = await db.accounts.get(tx.accountId);
      if (!account) throw new Error(`Account ${tx.accountId} not found`);
      if (account.isTrashed) throw new Error('Account is archived and cannot be modified');

      const minOrder = await getMinDisplayOrder(tx.date);
      const now = new Date().toISOString();
      const newTx: Transaction = {
        ...tx,
        displayOrder: minOrder - 1,
        createdAt: now,
        updatedAt: now,
      };

      const delta = getBalanceDelta(account, tx);
      await db.accounts.update(tx.accountId, {
        balance: account.balance + delta,
        updatedAt: now,
      });
      await db.transactions.add(newTx);
    })
  );
}

export async function revertTransaction(tx: Transaction): Promise<void> {
  return wrapQuotaError(
    db.transaction('rw', [db.accounts, db.transactions], async () => {
      const account = await db.accounts.get(tx.accountId);
      if (!account) throw new Error(`Account ${tx.accountId} not found`);
      if (account.isTrashed) throw new Error('Account is archived and cannot be modified');

      const now = new Date().toISOString();
      const delta = getBalanceDelta(account, tx);
      await db.accounts.update(tx.accountId, {
        balance: account.balance - delta,
        updatedAt: now,
      });
      // Hard-delete is intentional: Transaction has no isTrashed field (spec §3.7).
      // Soft-delete applies only to accounts and categories.
      await db.transactions.delete(tx.id!);
    })
  );
}

export async function replaceTransaction(
  oldTx: Transaction,
  newTx: Transaction
): Promise<void> {
  return wrapQuotaError(
    db.transaction('rw', [db.accounts, db.transactions], async () => {
      const now = new Date().toISOString();

      // Revert old balance effect
      const oldAccount = await db.accounts.get(oldTx.accountId);
      if (!oldAccount) throw new Error(`Account ${oldTx.accountId} not found`);
      if (oldAccount.isTrashed) throw new Error('Account is archived and cannot be modified');
      const oldDelta = getBalanceDelta(oldAccount, oldTx);

      // If account changed, update both accounts
      if (oldTx.accountId !== newTx.accountId) {
        await db.accounts.update(oldTx.accountId, {
          balance: oldAccount.balance - oldDelta,
          updatedAt: now,
        });
        const newAccount = await db.accounts.get(newTx.accountId);
        if (!newAccount) throw new Error(`Account ${newTx.accountId} not found`);
        if (newAccount.isTrashed) throw new Error('Account is archived and cannot be modified');
        const newDelta = getBalanceDelta(newAccount, newTx);
        await db.accounts.update(newTx.accountId, {
          balance: newAccount.balance + newDelta,
          updatedAt: now,
        });
      } else {
        // Same account — compute net delta
        // Re-fetch fresh account state (same as oldAccount since no prior update)
        const newDelta = getBalanceDelta(oldAccount, newTx);
        await db.accounts.update(oldTx.accountId, {
          balance: oldAccount.balance - oldDelta + newDelta,
          updatedAt: now,
        });
      }

      // Determine displayOrder for the updated record
      let displayOrder = oldTx.displayOrder;
      if (oldTx.date !== newTx.date) {
        const minOrder = await getMinDisplayOrder(newTx.date);
        displayOrder = minOrder - 1;
      }

      const updatedTx: Transaction = {
        ...newTx,
        id: oldTx.id,
        displayOrder,
        createdAt: oldTx.createdAt,
        updatedAt: now,
      };
      await db.transactions.put(updatedTx);
    })
  );
}

export async function applyTransfer(
  outTx: Transaction,
  inTx: Transaction
): Promise<void> {
  if (outTx.transferGroupId !== inTx.transferGroupId) {
    throw new Error('Transfer records must share the same transferGroupId');
  }
  return wrapQuotaError(
    db.transaction('rw', [db.accounts, db.transactions], async () => {
      const now = new Date().toISOString();

      const outAccount = await db.accounts.get(outTx.accountId);
      if (!outAccount) throw new Error(`Account ${outTx.accountId} not found`);
      if (outAccount.isTrashed) throw new Error('Account is archived and cannot be modified');

      const inAccount = await db.accounts.get(inTx.accountId);
      if (!inAccount) throw new Error(`Account ${inTx.accountId} not found`);
      if (inAccount.isTrashed) throw new Error('Account is archived and cannot be modified');

      const outDelta = getBalanceDelta(outAccount, outTx);
      const inDelta = getBalanceDelta(inAccount, inTx);

      await db.accounts.update(outTx.accountId, {
        balance: outAccount.balance + outDelta,
        updatedAt: now,
      });

      // If same account (edge case), re-read balance
      if (outTx.accountId === inTx.accountId) {
        const refreshed = await db.accounts.get(inTx.accountId);
        if (!refreshed) throw new Error(`Account ${inTx.accountId} not found`);
        await db.accounts.update(inTx.accountId, {
          balance: refreshed.balance + inDelta,
          updatedAt: now,
        });
      } else {
        await db.accounts.update(inTx.accountId, {
          balance: inAccount.balance + inDelta,
          updatedAt: now,
        });
      }

      // Insert outTx first so that inMinOrder sees it when dates are the same
      const outMinOrder = await getMinDisplayOrder(outTx.date);
      const outRecord: Transaction = {
        ...outTx,
        displayOrder: outMinOrder - 1,
        createdAt: now,
        updatedAt: now,
      };
      await db.transactions.add(outRecord);

      const inMinOrder = await getMinDisplayOrder(inTx.date);
      const inRecord: Transaction = {
        ...inTx,
        displayOrder: inMinOrder - 1,
        createdAt: now,
        updatedAt: now,
      };
      await db.transactions.add(inRecord);
    })
  );
}

export async function revertTransfer(transferGroupId: string): Promise<void> {
  return wrapQuotaError(
    db.transaction('rw', [db.accounts, db.transactions], async () => {
      const records = await db.transactions
        .where('transferGroupId')
        .equals(transferGroupId)
        .toArray();

      if (records.length !== 2) {
        throw new Error(
          `Expected 2 transfer records for group ${transferGroupId}, found ${records.length}`
        );
      }

      const now = new Date().toISOString();
      for (const record of records) {
        const account = await db.accounts.get(record.accountId);
        if (!account) throw new Error(`Account ${record.accountId} not found`);
        if (account.isTrashed) throw new Error('Account is archived and cannot be modified');
        const delta = getBalanceDelta(account, record);
        await db.accounts.update(record.accountId, {
          balance: account.balance - delta,
          updatedAt: now,
        });
        // Hard-delete is intentional: Transaction has no isTrashed field (spec §3.7).
        await db.transactions.delete(record.id!);
      }
    })
  );
}

export async function replaceTransfer(
  transferGroupId: string,
  outTx: Transaction,
  inTx: Transaction
): Promise<void> {
  return wrapQuotaError(
    db.transaction('rw', [db.accounts, db.transactions], async () => {
      const records = await db.transactions
        .where('transferGroupId')
        .equals(transferGroupId)
        .toArray();

      if (records.length !== 2) {
        throw new Error(
          `Expected 2 transfer records for group ${transferGroupId}, found ${records.length}`
        );
      }

      const now = new Date().toISOString();

      // Revert old records
      for (const record of records) {
        const account = await db.accounts.get(record.accountId);
        if (!account) throw new Error(`Account ${record.accountId} not found`);
        if (account.isTrashed) throw new Error('Account is archived and cannot be modified');
        const delta = getBalanceDelta(account, record);
        await db.accounts.update(record.accountId, {
          balance: account.balance - delta,
          updatedAt: now,
        });
        // Hard-delete is intentional: Transaction has no isTrashed field (spec §3.7).
        await db.transactions.delete(record.id!);
      }

      // Apply new records
      const outAccount = await db.accounts.get(outTx.accountId);
      if (!outAccount) throw new Error(`Account ${outTx.accountId} not found`);
      if (outAccount.isTrashed) throw new Error('Account is archived and cannot be modified');
      const inAccount = await db.accounts.get(inTx.accountId);
      if (!inAccount) throw new Error(`Account ${inTx.accountId} not found`);
      if (inAccount.isTrashed) throw new Error('Account is archived and cannot be modified');

      const outDelta = getBalanceDelta(outAccount, outTx);
      const inDelta = getBalanceDelta(inAccount, inTx);

      await db.accounts.update(outTx.accountId, {
        balance: outAccount.balance + outDelta,
        updatedAt: now,
      });

      if (outTx.accountId === inTx.accountId) {
        const refreshed = await db.accounts.get(inTx.accountId);
        if (!refreshed) throw new Error(`Account ${inTx.accountId} not found`);
        await db.accounts.update(inTx.accountId, {
          balance: refreshed.balance + inDelta,
          updatedAt: now,
        });
      } else {
        await db.accounts.update(inTx.accountId, {
          balance: inAccount.balance + inDelta,
          updatedAt: now,
        });
      }

      // Insert outTx first so that inMinOrder sees it when dates are the same
      const outMinOrder = await getMinDisplayOrder(outTx.date);
      await db.transactions.add({
        ...outTx,
        displayOrder: outMinOrder - 1,
        createdAt: now,
        updatedAt: now,
      });

      const inMinOrder = await getMinDisplayOrder(inTx.date);
      await db.transactions.add({
        ...inTx,
        displayOrder: inMinOrder - 1,
        createdAt: now,
        updatedAt: now,
      });
    })
  );
}

export async function adjustBalance(
  accountId: number,
  newBalance: number
): Promise<void> {
  return wrapQuotaError(
    db.transaction('rw', [db.accounts], async () => {
      const account = await db.accounts.get(accountId);
      if (!account) throw new Error(`Account ${accountId} not found`);
      if (account.isTrashed) throw new Error('Account is archived and cannot be modified');
      await db.accounts.update(accountId, {
        balance: newBalance,
        updatedAt: new Date().toISOString(),
      });
    })
  );
}
