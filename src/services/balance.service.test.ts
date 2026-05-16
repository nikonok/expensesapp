import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/database";
import type { Account, Transaction } from "@/db/models";

vi.mock("./log.service", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "./log.service";
import {
  adjustBalance,
  applyTransaction,
  applyTransfer,
  replaceTransaction,
  replaceTransfer,
  revertTransaction,
  revertTransfer,
} from "./balance.service";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Test Account",
    type: "REGULAR",
    color: "oklch(0.7 0.2 180)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 1000,
    startingBalance: 1000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTx(accountId: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: "EXPENSE",
    date: "2026-01-01",
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId,
    categoryId: 1,
    currency: "USD",
    amount: 100,
    amountMainCurrency: 100,
    exchangeRate: 1,
    note: "",
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

describe("applyTransaction", () => {
  it("INCOME increases account balance", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: "INCOME", amount: 200 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(700);
  });

  it("EXPENSE decreases account balance", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 150 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(350);
  });

  it("sets displayOrder to min-1 for the date", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx1 = makeTx(id as number, { type: "EXPENSE", amount: 10, date: "2026-01-01" });
    const tx2 = makeTx(id as number, { type: "EXPENSE", amount: 10, date: "2026-01-01" });
    await applyTransaction(tx1);
    await applyTransaction(tx2);
    const all = await db.transactions.where("date").equals("2026-01-01").toArray();
    expect(all[0].displayOrder).toBe(0);
    expect(all[1].displayOrder).toBe(-1);
  });
});

describe("revertTransaction", () => {
  it("EXPENSE revert restores balance", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 150 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    await revertTransaction(saved!);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(500);
    const remaining = await db.transactions.count();
    expect(remaining).toBe(0);
  });

  it("INCOME revert restores balance", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    const tx = makeTx(id as number, { type: "INCOME", amount: 200 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    await revertTransaction(saved!);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(500);
  });
});

describe("replaceTransaction", () => {
  it("replaces expense amount — balance correctly updated", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 100 });
    await applyTransaction(tx);
    // balance is now 900
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, amount: 250 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(750); // 1000 - 250
  });

  it("replaces expense with income — balance correctly updated", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 100 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, type: "INCOME" as const, amount: 50 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(1050); // 1000 + 50
  });

  it("preserves displayOrder when date unchanged", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 100, date: "2026-01-01" });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    const origOrder = saved!.displayOrder;
    const updated = { ...saved!, amount: 200 };
    await replaceTransaction(saved!, updated);
    const updatedSaved = await db.transactions.toCollection().first();
    expect(updatedSaved!.displayOrder).toBe(origOrder);
  });

  it("updates displayOrder when date changes", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 1000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 100, date: "2026-01-01" });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, date: "2026-02-01" };
    await replaceTransaction(saved!, updated);
    const updatedSaved = await db.transactions.toCollection().first();
    expect(updatedSaved!.displayOrder).toBe(0);
    expect(updatedSaved!.date).toBe("2026-02-01");
  });
});

describe("applyTransfer + revertTransfer", () => {
  it("transfer updates both account balances", async () => {
    const srcId = await db.accounts.add(makeAccount({ balance: 1000, name: "Source" }));
    const dstId = await db.accounts.add(makeAccount({ balance: 500, name: "Dest" }));

    const groupId = "test-group-uuid-1234";
    const outTx = makeTx(srcId as number, {
      type: "TRANSFER",
      amount: 200,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(dstId as number, {
      type: "TRANSFER",
      amount: 200,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);

    const src = await db.accounts.get(srcId as number);
    const dst = await db.accounts.get(dstId as number);
    expect(src!.balance).toBe(800); // 1000 - 200
    expect(dst!.balance).toBe(700); // 500 + 200
  });

  it("revertTransfer restores both balances", async () => {
    const srcId = await db.accounts.add(makeAccount({ balance: 1000, name: "Source" }));
    const dstId = await db.accounts.add(makeAccount({ balance: 500, name: "Dest" }));

    const groupId = "test-group-uuid-5678";
    const outTx = makeTx(srcId as number, {
      type: "TRANSFER",
      amount: 300,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(dstId as number, {
      type: "TRANSFER",
      amount: 300,
      transferGroupId: groupId,
      transferDirection: "IN",
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

describe("adjustBalance", () => {
  it("sets exact balance value directly", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    await adjustBalance(id as number, 9999);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(9999);
  });

  it("can set balance to zero", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 500 }));
    await adjustBalance(id as number, 0);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(0);
  });
});

describe("DEBT account exceptions", () => {
  it("EXPENSE on DEBT account increases balance", async () => {
    const id = await db.accounts.add(makeAccount({ type: "DEBT", balance: 500 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 100 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(600); // 500 + 100 (debt grows)
  });

  it("INCOME on DEBT account decreases balance", async () => {
    const id = await db.accounts.add(makeAccount({ type: "DEBT", balance: 500 }));
    const tx = makeTx(id as number, { type: "INCOME", amount: 100 });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(400); // 500 - 100 (debt reduced)
  });

  it("TRANSFER IN to DEBT account reduces balance (payment)", async () => {
    const srcId = await db.accounts.add(makeAccount({ balance: 1000, name: "Source" }));
    const debtId = await db.accounts.add(makeAccount({ type: "DEBT", balance: 500, name: "Debt" }));

    const groupId = "debt-payment-uuid";
    const outTx = makeTx(srcId as number, {
      type: "TRANSFER",
      amount: 200,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(debtId as number, {
      type: "TRANSFER",
      amount: 200,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);

    const debt = await db.accounts.get(debtId as number);
    expect(debt!.balance).toBe(300); // 500 - 200 (debt reduced by payment)
  });

  it("TRANSFER OUT from DEBT account increases balance (borrowing more)", async () => {
    const debtId = await db.accounts.add(makeAccount({ type: "DEBT", balance: 500, name: "Debt" }));
    const dstId = await db.accounts.add(makeAccount({ balance: 0, name: "Dest" }));

    const groupId = "debt-borrow-uuid";
    const outTx = makeTx(debtId as number, {
      type: "TRANSFER",
      amount: 200,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(dstId as number, {
      type: "TRANSFER",
      amount: 200,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);

    const debt = await db.accounts.get(debtId as number);
    expect(debt!.balance).toBe(700); // 500 + 200 (more debt)
  });

  it("revert of EXPENSE on DEBT account restores balance", async () => {
    const id = await db.accounts.add(makeAccount({ type: "DEBT", balance: 500 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 100 });
    await applyTransaction(tx);
    const saved = await db.transactions.toCollection().first();
    await revertTransaction(saved!);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(500);
  });
});

describe("error paths", () => {
  it("applyTransaction rejects and calls logger.error with tx.apply.failed when account does not exist", async () => {
    const tx = makeTx(99999, { type: "EXPENSE", amount: 100 });
    await expect(applyTransaction(tx)).rejects.toThrow();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "tx.apply.failed",
      expect.objectContaining({ accountId: 99999 }),
    );
  });

  it("revertTransaction rejects and calls logger.error with tx.delete.failed when account does not exist", async () => {
    const tx = makeTx(99999, { type: "EXPENSE", amount: 100, id: 99999 } as Partial<Transaction>);
    await expect(revertTransaction(tx)).rejects.toThrow();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "tx.delete.failed",
      expect.objectContaining({ id: 99999 }),
    );
  });

  it("adjustBalance rejects and calls logger.error with account.balance.adjust.failed when account does not exist", async () => {
    await expect(adjustBalance(99999, 1000)).rejects.toThrow();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "account.balance.adjust.failed",
      expect.objectContaining({ accountId: 99999 }),
    );
  });
});

describe("replaceTransaction on DEBT account", () => {
  it("changing amount on a DEBT EXPENSE applies correct net delta", async () => {
    // EXPENSE on DEBT increases balance (debt grows)
    const id = await db.accounts.add(makeAccount({ type: "DEBT", balance: 1000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 200 });
    await applyTransaction(tx);
    // balance is now 1200 (1000 + 200)
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, amount: 300 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    // old delta was +200, new delta is +300, net: 1200 - 200 + 300 = 1300
    expect(account!.balance).toBe(1300);
  });

  it("changing type from EXPENSE to INCOME on a DEBT account reverses the balance effect", async () => {
    // EXPENSE on DEBT increases balance; INCOME on DEBT decreases balance
    const id = await db.accounts.add(makeAccount({ type: "DEBT", balance: 1000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 200 });
    await applyTransaction(tx);
    // balance is now 1200
    const saved = await db.transactions.toCollection().first();
    const updated = { ...saved!, type: "INCOME" as const, amount: 150 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    // old delta was +200 (EXPENSE on DEBT), new delta is -150 (INCOME on DEBT)
    // net: 1200 - 200 + (-150) = 850
    expect(account!.balance).toBe(850);
  });

  it("stored balance is exactly correct — not just directionally correct — after DEBT replace", async () => {
    const id = await db.accounts.add(makeAccount({ type: "DEBT", balance: 5000 }));
    const tx = makeTx(id as number, { type: "EXPENSE", amount: 500 });
    await applyTransaction(tx);
    // balance: 5000 + 500 = 5500
    const saved = await db.transactions.toCollection().first();
    // Change to INCOME 300 — should reduce debt
    const updated = { ...saved!, type: "INCOME" as const, amount: 300 };
    await replaceTransaction(saved!, updated);
    const account = await db.accounts.get(id as number);
    // old delta: +500, new delta: -300 → 5500 - 500 + (-300) = 4700
    expect(account!.balance).toBe(4700);
  });
});

describe("applyTransaction — foreign-currency account", () => {
  it("INCOME on a foreign-currency account uses tx.amount (account currency), not amountMainCurrency", async () => {
    // EUR account — balance tracked in EUR minor units, not converted to main currency
    const id = await db.accounts.add(makeAccount({ balance: 0, currency: "EUR" }));
    const tx = makeTx(id as number, {
      type: "INCOME",
      currency: "EUR",
      amount: 1000,
      amountMainCurrency: 1080,
      exchangeRate: 1.08,
    });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(1000); // account balance in EUR, NOT 1080 (USD equivalent)
  });

  it("EXPENSE on a foreign-currency account uses tx.amount (account currency), not amountMainCurrency", async () => {
    const id = await db.accounts.add(makeAccount({ balance: 5000, currency: "EUR" }));
    const tx = makeTx(id as number, {
      type: "EXPENSE",
      currency: "EUR",
      amount: 500,
      amountMainCurrency: 540,
      exchangeRate: 1.08,
    });
    await applyTransaction(tx);
    const account = await db.accounts.get(id as number);
    expect(account!.balance).toBe(4500); // 5000 - 500 (EUR), NOT 5000 - 540
  });
});

describe("replaceTransaction changing accountId", () => {
  it("moves a transaction from one account to another and updates both balances correctly", async () => {
    const idA = await db.accounts.add(makeAccount({ balance: 10000, name: "Account A" }));
    const idB = await db.accounts.add(makeAccount({ balance: 5000, name: "Account B" }));

    const tx = makeTx(idA as number, { type: "EXPENSE", amount: 2000 });
    await applyTransaction(tx);
    // A balance: 10000 - 2000 = 8000

    const saved = await db.transactions.toCollection().first();
    // Edit: move to account B, change amount to 3000
    const updated = { ...saved!, accountId: idB as number, amount: 3000 };
    await replaceTransaction(saved!, updated);

    const accountA = await db.accounts.get(idA as number);
    const accountB = await db.accounts.get(idB as number);
    // A: old EXPENSE 2000 reverted → 8000 + 2000 = 10000
    expect(accountA!.balance).toBe(10000);
    // B: new EXPENSE 3000 applied → 5000 - 3000 = 2000
    expect(accountB!.balance).toBe(2000);
  });
});

describe("replaceTransaction — account change AND type change crossing DEBT boundary", () => {
  it("correctly reverts source account and applies new type to DEBT destination", async () => {
    const idA = await db.accounts.add(makeAccount({ type: "REGULAR", balance: 10000, name: "A" }));
    const idB = await db.accounts.add(makeAccount({ type: "DEBT", balance: 50000, name: "B Debt" }));

    // Apply EXPENSE 2000 to Account A (REGULAR)
    const tx = makeTx(idA as number, { type: "EXPENSE", amount: 2000 });
    await applyTransaction(tx);
    // A balance: 10000 - 2000 = 8000

    const saved = await db.transactions.toCollection().first();

    // Replace: move to Account B (DEBT), change type to INCOME, amount 3000
    const updated = { ...saved!, accountId: idB as number, type: "INCOME" as const, amount: 3000 };
    await replaceTransaction(saved!, updated);

    const accountA = await db.accounts.get(idA as number);
    const accountB = await db.accounts.get(idB as number);

    // A: old EXPENSE 2000 reverted → 8000 + 2000 = 10000
    expect(accountA!.balance).toBe(10000);
    // B (DEBT): INCOME delta = -3000 (INCOME on DEBT reduces balance) → 50000 - 3000 = 47000
    expect(accountB!.balance).toBe(47000);
  });
});

describe("replaceTransfer", () => {
  it("editing transfer amount updates both account balances correctly", async () => {
    const idA = await db.accounts.add(makeAccount({ balance: 10000, name: "A" }));
    const idB = await db.accounts.add(makeAccount({ balance: 5000, name: "B" }));

    const groupId = "replace-transfer-amount-uuid";
    const outTx = makeTx(idA as number, {
      type: "TRANSFER",
      amount: 2000,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(idB as number, {
      type: "TRANSFER",
      amount: 2000,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);
    // A: 10000 - 2000 = 8000, B: 5000 + 2000 = 7000

    const newOutTx = makeTx(idA as number, {
      type: "TRANSFER",
      amount: 3000,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const newInTx = makeTx(idB as number, {
      type: "TRANSFER",
      amount: 3000,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await replaceTransfer(groupId, newOutTx, newInTx);

    const accountA = await db.accounts.get(idA as number);
    const accountB = await db.accounts.get(idB as number);
    // revert: A→10000, B→5000; apply new 3000: A→7000, B→8000
    expect(accountA!.balance).toBe(7000);
    expect(accountB!.balance).toBe(8000);
  });

  it("editing transfer accounts reverts source account balance and updates new destination", async () => {
    const idA = await db.accounts.add(makeAccount({ balance: 10000, name: "A" }));
    const idB = await db.accounts.add(makeAccount({ balance: 5000, name: "B" }));
    const idC = await db.accounts.add(makeAccount({ balance: 3000, name: "C" }));

    const groupId = "replace-transfer-accounts-uuid";
    const outTx = makeTx(idA as number, {
      type: "TRANSFER",
      amount: 2000,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(idB as number, {
      type: "TRANSFER",
      amount: 2000,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);
    // A: 8000, B: 7000, C: 3000

    // Edit: change destination from B to C, same amount
    const newOutTx = makeTx(idA as number, {
      type: "TRANSFER",
      amount: 2000,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const newInTx = makeTx(idC as number, {
      type: "TRANSFER",
      amount: 2000,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await replaceTransfer(groupId, newOutTx, newInTx);

    const accountA = await db.accounts.get(idA as number);
    const accountB = await db.accounts.get(idB as number);
    const accountC = await db.accounts.get(idC as number);
    // revert: A→10000, B→5000, C→3000; apply A→C 2000: A→8000, B→5000, C→5000
    expect(accountA!.balance).toBe(8000);
    expect(accountB!.balance).toBe(5000);
    expect(accountC!.balance).toBe(5000);
  });

  it("editing both amount and accounts simultaneously updates all three account balances correctly", async () => {
    const idA = await db.accounts.add(makeAccount({ balance: 10000, name: "A" }));
    const idB = await db.accounts.add(makeAccount({ balance: 5000, name: "B" }));
    const idC = await db.accounts.add(makeAccount({ balance: 3000, name: "C" }));

    const groupId = "replace-transfer-both-uuid";
    const outTx = makeTx(idA as number, {
      type: "TRANSFER",
      amount: 1000,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const inTx = makeTx(idB as number, {
      type: "TRANSFER",
      amount: 1000,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await applyTransfer(outTx, inTx);
    // A: 9000, B: 6000, C: 3000

    // Edit: change source to C, destination to A, amount to 500
    const newOutTx = makeTx(idC as number, {
      type: "TRANSFER",
      amount: 500,
      transferGroupId: groupId,
      transferDirection: "OUT",
      categoryId: null,
    });
    const newInTx = makeTx(idA as number, {
      type: "TRANSFER",
      amount: 500,
      transferGroupId: groupId,
      transferDirection: "IN",
      categoryId: null,
    });

    await replaceTransfer(groupId, newOutTx, newInTx);

    const accountA = await db.accounts.get(idA as number);
    const accountB = await db.accounts.get(idB as number);
    const accountC = await db.accounts.get(idC as number);
    // revert: A→10000, B→5000, C→3000; apply C→A 500: C→2500, A→10500, B→5000
    expect(accountA!.balance).toBe(10500);
    expect(accountB!.balance).toBe(5000);
    expect(accountC!.balance).toBe(2500);
  });
});

describe("revertTransfer error handling", () => {
  it("throws when groupId has only 1 matching record", async () => {
    const idA = await db.accounts.add(makeAccount({ balance: 1000, name: "A" }));
    const groupId = "incomplete-transfer-uuid";
    // Manually insert only one transfer record (simulate corrupt/partial state)
    await db.transactions.add(
      makeTx(idA as number, {
        type: "TRANSFER",
        amount: 100,
        transferGroupId: groupId,
        transferDirection: "OUT",
        categoryId: null,
        displayOrder: 0,
      }),
    );
    await expect(revertTransfer(groupId)).rejects.toThrow(
      "Expected 2 transfer records for group incomplete-transfer-uuid, found 1",
    );
  });

  it("throws when groupId has 0 matching records", async () => {
    await expect(revertTransfer("nonexistent-group-uuid")).rejects.toThrow(
      "Expected 2 transfer records for group nonexistent-group-uuid, found 0",
    );
  });
});
