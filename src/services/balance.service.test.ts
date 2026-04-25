import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import type { Account, Transaction } from '@/db/models';

vi.mock('./log.service', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from './log.service';
import {
  adjustBalance,
  applyTransaction,
  applyTransfer,
  replaceTransaction,
  revertTransaction,
  revertTransfer,
} from './balance.service';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: 'Test Account',
    type: 'REGULAR',
    color: 'oklch(0.7 0.2 180)',
    icon: 'wallet',
    currency: 'USD',
    description: '',
    balance: 1000,
    startingBalance: 1000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTx(
  accountId: number,
  overrides: Partial<Transaction> = {}
): Transaction {
  return {
    type: 'EXPENSE',
    date: '2026-01-01',
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId,
    categoryId: 1,
    currency: 'USD',
    amount: 100,
    amountMainCurrency: 100,
    exchangeRate: 1,
    note: '',
    transferGroupId: null,
    transferDirection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.accounts.clear();
  await db.transactions.clear();
});

describe('applyTransaction', () => {
  it('INCOME increases account balance', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: 'INCOME', amount: 200 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(700);
  });

  it('EXPENSE decreases account balance', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 150 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(350);
  });

  it('sets displayOrder to min-1 for the date', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx1 = makeTx(id as number, { type: 'EXPENSE', amount: 10, date: '2026-01-01' });
    const tx2 = makeTx(id as number, { type: 'EXPENSE', amount: 10, date: '2026-01-01' });
    await applyTransaction(tx1);
    await applyTransaction(tx2);
    const all = await db.transactions.where('date').equals('2026-01-01').toArray();
    expect(all[0].displayOrder).toBe(0);
    expect(all[1].displayOrder).toBe(-1);
  });
});

describe('revertTransaction', () => {
  it('EXPENSE revert restores balance', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 150 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    await revertTransaction(saved!);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(500);
    const remaining = await db.transactions.count();
    expect(remaining).toBe(0);
  });

  it('INCOME revert restores balance', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: 'INCOME', amount: 200 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    await revertTransaction(saved!);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(500);
  });
});

describe('replaceTransaction', () => {
  it('replaces expense amount — balance correctly updated', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 100 });
    await applyTransaction(tx);
    // balance is now 900
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, amount: 250 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(750); // 1000 - 250
  });

  it('replaces expense with income — balance correctly updated', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 100 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, type: 'INCOME' as const, amount: 50 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(1050); // 1000 + 50
  });

  it('preserves displayOrder when date unchanged', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 100, date: '2026-01-01' });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    const origOrder = saved!.displayOrder;
    const updated = { ...saved!, amount: 200 };
    await replaceTransaction(saved!, updated);
    const updatedSaved = await db.transactions.toCollection().first();
    expect(updatedSaved!.displayOrder).toBe(origOrder);
  });

  it('updates displayOrder when date changes', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 100, date: '2026-01-01' });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, date: '2026-02-01' };
    await replaceTransaction(saved!, updated);
    const updatedSaved = await db.transactions.toCollection().first();
    expect(updatedSaved!.displayOrder).toBe(0);
    expect(updatedSaved!.date).toBe('2026-02-01');
  });
});

describe('applyTransfer + revertTransfer', () => {
  it('transfer updates both account balances', async () => {
    const srcId = await db.accounts.add(makeAccount({ balance: 1000, name: 'Source' }));
    const dstId = await db.accounts.add(makeAccount({ balance: 500, name: 'Dest' }));

    const groupId = 'test-group-uuid-1234';
    const outTx = makeTx(srcId as number, {
      type: 'TRANSFER',
      amount: 200,
      transferGroupId: groupId,
      transferDirection: 'OUT',
      categoryId: null,
    });
    const inTx = makeTx(dstId as number, {
      type: 'TRANSFER',
      amount: 200,
      transferGroupId: groupId,
      transferDirection: 'IN',
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);

    const src = await db.accounts.get(srcId as number);
    const dst = await db.accounts.get(dstId as number);
    expect(src!.balance).toBe(800); // 1000 - 200
    expect(dst!.balance).toBe(700); // 500 + 200
  });

  it('revertTransfer restores both balances', async () => {
    const srcId = await db.accounts.add(makeAccount({ balance: 1000, name: 'Source' }));
    const dstId = await db.accounts.add(makeAccount({ balance: 500, name: 'Dest' }));

    const groupId = 'test-group-uuid-5678';
    const outTx = makeTx(srcId as number, {
      type: 'TRANSFER',
      amount: 300,
      transferGroupId: groupId,
      transferDirection: 'OUT',
      categoryId: null,
    });
    const inTx = makeTx(dstId as number, {
      type: 'TRANSFER',
      amount: 300,
      transferGroupId: groupId,
      transferDirection: 'IN',
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);
    await revertTransfer(groupId);

    const src = await db.accounts.get(srcId as number);
    const dst = await db.accounts.get(dstId as number);
    expect(src!.balance).toBe(1000);
    expect(dst!.balance).toBe(500);
    const txCount = await db.transactions.count();
    expect(txCount).toBe(0);
  });
});

describe('adjustBalance', () => {
  it('sets exact balance value directly', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    await adjustBalance(id as number, 9999);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(9999);
  });

  it('can set balance to zero', async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    await adjustBalance(id as number, 0);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(0);
  });
});

describe('DEBT account exceptions', () => {
  it('EXPENSE on DEBT account increases balance', async () => {
    const id = await db.accounts.add(makeAccount({ type: 'DEBT', balance: 500 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 100 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(600); // 500 + 100 (debt grows)
  });

  it('INCOME on DEBT account decreases balance', async () => {
    const id = await db.accounts.add(makeAccount({ type: 'DEBT', balance: 500 }));
    const tx = makeTx(id as number, { type: 'INCOME', amount: 100 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(400); // 500 - 100 (debt reduced)
  });

  it('TRANSFER IN to DEBT account reduces balance (payment)', async () => {
    const srcId = await db.accounts.add(makeAccount({ balance: 1000, name: 'Source' }));
    const debtId = await db.accounts.add(makeAccount({ type: 'DEBT', balance: 500, name: 'Debt' }));

    const groupId = 'debt-payment-uuid';
    const outTx = makeTx(srcId as number, {
      type: 'TRANSFER',
      amount: 200,
      transferGroupId: groupId,
      transferDirection: 'OUT',
      categoryId: null,
    });
    const inTx = makeTx(debtId as number, {
      type: 'TRANSFER',
      amount: 200,
      transferGroupId: groupId,
      transferDirection: 'IN',
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);

    const debt = await db.accounts.get(debtId as number);
    expect(debt!.balance).toBe(300); // 500 - 200 (debt reduced by payment)
  });

  it('TRANSFER OUT from DEBT account increases balance (borrowing more)', async () => {
    const debtId = await db.accounts.add(makeAccount({ type: 'DEBT', balance: 500, name: 'Debt' }));
    const dstId = await db.accounts.add(makeAccount({ balance: 0, name: 'Dest' }));

    const groupId = 'debt-borrow-uuid';
    const outTx = makeTx(debtId as number, {
      type: 'TRANSFER',
      amount: 200,
      transferGroupId: groupId,
      transferDirection: 'OUT',
      categoryId: null,
    });
    const inTx = makeTx(dstId as number, {
      type: 'TRANSFER',
      amount: 200,
      transferGroupId: groupId,
      transferDirection: 'IN',
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);

    const debt = await db.accounts.get(debtId as number);
    expect(debt!.balance).toBe(700); // 500 + 200 (more debt)
  });

  it('revert of EXPENSE on DEBT account restores balance', async () => {
    const id = await db.accounts.add(makeAccount({ type: 'DEBT', balance: 500 }));
    const tx = makeTx(id as number, { type: 'EXPENSE', amount: 100 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    await revertTransaction(saved!);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(500);
  });
});

describe('error paths', () => {
  it('applyTransaction rejects and calls logger.error with tx.apply.failed when account does not exist', async () => {
    const tx = makeTx(99999, { type: 'EXPENSE', amount: 100 });
    await expect(applyTransaction(tx)).rejects.toThrow();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'tx.apply.failed',
      expect.objectContaining({ accountId: 99999 }),
    );
  });

  it('revertTransaction rejects and calls logger.error with tx.delete.failed when account does not exist', async () => {
    const tx = makeTx(99999, { type: 'EXPENSE', amount: 100, id: 99999 } as Partial<Transaction>);
    await expect(revertTransaction(tx)).rejects.toThrow();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'tx.delete.failed',
      expect.objectContaining({ id: 99999 }),
    );
  });

  it('adjustBalance rejects and calls logger.error with account.balance.adjust.failed when account does not exist', async () => {
    await expect(adjustBalance(99999, 1000)).rejects.toThrow();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'account.balance.adjust.failed',
      expect.objectContaining({ accountId: 99999 }),
    );
  });
});
