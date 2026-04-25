// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

vi.mock("../db/database", () => ({
  db: {
    transactions: {
      where: vi.fn(),
    },
    accounts: { toArray: vi.fn() },
    categories: { toArray: vi.fn() },
  },
}));

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({ mock: "sheet" })),
    book_new: vi.fn(() => ({ mock: "workbook" })),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { db } from "../db/database";
import { exportService } from "./export.service";
import type { Transaction } from "../db/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: "EXPENSE",
    date: "2026-01-15",
    timestamp: new Date().toISOString(),
    displayOrder: 0,
    accountId: 1,
    categoryId: 1,
    currency: "USD",
    amount: 1000,
    amountMainCurrency: 1000,
    exchangeRate: 1,
    note: "",
    transferGroupId: null,
    transferDirection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function setupDomMocks() {
  const clickMock = vi.fn();
  const anchor = { href: "", download: "", click: clickMock } as unknown as HTMLAnchorElement;
  vi.spyOn(document, "createElement").mockReturnValue(anchor);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { anchor, clickMock };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let mockTxQuery: { between: ReturnType<typeof vi.fn>; sortBy: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();

  mockTxQuery = {
    between: vi.fn().mockReturnThis(),
    sortBy: vi.fn().mockResolvedValue([]),
  };
  vi.mocked(db.transactions.where).mockReturnValue(mockTxQuery as any);

  vi.mocked(db.accounts.toArray).mockResolvedValue([
    {
      id: 1,
      name: "Checking",
      type: "REGULAR",
      color: "",
      icon: "",
      currency: "USD",
      description: "",
      balance: 0,
      startingBalance: 0,
      includeInTotal: true,
      isTrashed: false,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: 2,
      name: "Savings",
      type: "REGULAR",
      color: "",
      icon: "",
      currency: "USD",
      description: "",
      balance: 0,
      startingBalance: 0,
      includeInTotal: true,
      isTrashed: false,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: 3,
      name: "Mortgage",
      type: "DEBT",
      color: "",
      icon: "",
      currency: "USD",
      description: "",
      balance: 0,
      startingBalance: 0,
      includeInTotal: true,
      isTrashed: false,
      createdAt: "",
      updatedAt: "",
    },
  ]);

  vi.mocked(db.categories.toArray).mockResolvedValue([
    {
      id: 1,
      name: "Food",
      type: "EXPENSE",
      color: "",
      icon: "",
      displayOrder: 0,
      isTrashed: false,
      createdAt: "",
      updatedAt: "",
    },
  ]);

  setupDomMocks();
});

// ── Helpers to get sheet data ─────────────────────────────────────────────────

async function getExpensesSheetData(): Promise<(string | number)[][]> {
  const XLSX = await import("xlsx");
  return vi.mocked(XLSX.utils.aoa_to_sheet).mock.calls[0][0] as (string | number)[][];
}

async function getIncomesSheetData(): Promise<(string | number)[][]> {
  const XLSX = await import("xlsx");
  return vi.mocked(XLSX.utils.aoa_to_sheet).mock.calls[1][0] as (string | number)[][];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("exportService.exportTransactions", () => {
  describe("two worksheet tabs", () => {
    it("calls book_append_sheet twice — once for Expenses, once for Incomes", async () => {
      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const XLSX = await import("xlsx");
      const calls = vi.mocked(XLSX.utils.book_append_sheet).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][2]).toBe("Expenses");
      expect(calls[1][2]).toBe("Incomes");
    });

    it("routes EXPENSE transactions to Expenses sheet only", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", amountMainCurrency: 2000, categoryId: 1 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows).toHaveLength(1);
      expect(incomeRows).toHaveLength(0);
    });

    it("routes INCOME transactions to Incomes sheet only", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "INCOME", amountMainCurrency: 3000, categoryId: 1 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows).toHaveLength(0);
      expect(incomeRows).toHaveLength(1);
    });
  });

  describe("debt payment handling", () => {
    it("emits 1 Expenses row and 0 Incomes rows for a debt payment transfer pair", async () => {
      const groupId = "debt-group-uuid";
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({
          id: 10,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "OUT",
          amountMainCurrency: 50000,
          accountId: 1,
          toAccountId: 3,
          categoryId: null,
          note: "Mortgage payment",
        }),
        makeTx({
          id: 11,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "IN",
          amountMainCurrency: 50000,
          accountId: 3,
          toAccountId: null,
          categoryId: null,
        }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows).toHaveLength(1);
      expect(incomeRows).toHaveLength(0);
    });

    it("uses the debt account name as category for debt payment", async () => {
      const groupId = "debt-group-uuid-2";
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({
          id: 20,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "OUT",
          amountMainCurrency: 50000,
          accountId: 1,
          toAccountId: 3,
          categoryId: null,
        }),
        makeTx({
          id: 21,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "IN",
          amountMainCurrency: 50000,
          accountId: 3,
          toAccountId: null,
          categoryId: null,
        }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      // col 3 = Category
      expect(expenseRows[0][3]).toBe("Mortgage");
    });

    it("writes the debt payment amount correctly", async () => {
      const groupId = "debt-group-uuid-3";
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({
          id: 30,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "OUT",
          amountMainCurrency: 75000,
          accountId: 1,
          toAccountId: 3,
          categoryId: null,
        }),
        makeTx({
          id: 31,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "IN",
          amountMainCurrency: 75000,
          accountId: 3,
          toAccountId: null,
          categoryId: null,
        }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      // col 1 = Amount
      expect(expenseRows[0][1]).toBe(750);
    });
  });

  describe("regular transfer handling", () => {
    it("emits 1 Expenses row and 1 Incomes row for a regular transfer pair", async () => {
      const groupId = "regular-transfer-uuid";
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({
          id: 40,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "OUT",
          amountMainCurrency: 10000,
          accountId: 1,
          toAccountId: null,
          categoryId: null,
        }),
        makeTx({
          id: 41,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "IN",
          amountMainCurrency: 10000,
          accountId: 2,
          toAccountId: null,
          categoryId: null,
        }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows).toHaveLength(1);
      expect(incomeRows).toHaveLength(1);
    });

    it('uses "Transfer" as category for regular transfer rows', async () => {
      const groupId = "regular-transfer-uuid-2";
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({
          id: 50,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "OUT",
          amountMainCurrency: 5000,
          accountId: 1,
          toAccountId: null,
          categoryId: null,
        }),
        makeTx({
          id: 51,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "IN",
          amountMainCurrency: 5000,
          accountId: 2,
          toAccountId: null,
          categoryId: null,
        }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows[0][3]).toBe("Transfer");
      expect(incomeRows[0][3]).toBe("Transfer");
    });
  });

  describe("amount conversion (integer minor units)", () => {
    it("writes expense amount as amountMainCurrency / 100", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", amountMainCurrency: 2000, categoryId: 1 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      // col 1 = Amount
      expect(sheetData[1][1]).toBe(20);
    });

    it("writes income amount as amountMainCurrency / 100", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "INCOME", amountMainCurrency: 1050, categoryId: 1 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getIncomesSheetData();
      expect(sheetData[1][1]).toBe(10.5);
    });

    it("amountMainCurrency=1 → spreadsheet value 0.01 (integer minor unit boundary)", async () => {
      mockTxQuery.sortBy.mockResolvedValue([makeTx({ type: "INCOME", amountMainCurrency: 1 })]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getIncomesSheetData();
      expect(sheetData[1][1]).toBe(0.01);
    });

    it("amountMainCurrency=100000 → spreadsheet value 1000 (large integer)", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", amountMainCurrency: 100000 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      expect(sheetData[1][1]).toBe(1000);
    });
  });

  describe("trashed transaction filtering", () => {
    it("excludes isTrashed transactions from XLSX output", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ id: 1, amountMainCurrency: 5000, isTrashed: false }),
        makeTx({ id: 2, amountMainCurrency: 20000, isTrashed: true }),
      ]);

      await exportService.exportTransactions("2026-04-01", "2026-04-30", "USD");

      const sheetData = await getExpensesSheetData();
      const dataRows = sheetData.slice(1);
      expect(dataRows).toHaveLength(1);
      expect(dataRows[0]).toContain(50); // 5000 / 100
      expect(dataRows[0]).not.toContain(200); // 20000 / 100 should not appear
    });

    it("produces zero data rows when all transactions are trashed", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ id: 1, isTrashed: true }),
        makeTx({ id: 2, isTrashed: true }),
      ]);

      await exportService.exportTransactions("2026-04-01", "2026-04-30", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows).toHaveLength(0);
      expect(incomeRows).toHaveLength(0);
    });
  });

  describe("transfer deduplication", () => {
    it("emits exactly one row per sheet for a regular transfer pair (not two each)", async () => {
      const groupId = "dedup-group-uuid";
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({
          id: 20,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "OUT",
          amountMainCurrency: 3000,
          accountId: 1,
          categoryId: null,
        }),
        makeTx({
          id: 21,
          type: "TRANSFER",
          transferGroupId: groupId,
          transferDirection: "IN",
          amountMainCurrency: 3000,
          accountId: 2,
          categoryId: null,
        }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const expenseRows = (await getExpensesSheetData()).slice(1);
      const incomeRows = (await getIncomesSheetData()).slice(1);
      expect(expenseRows).toHaveLength(1);
      expect(incomeRows).toHaveLength(1);
    });
  });

  describe("date range filtering", () => {
    it("queries Dexie with the provided start and end date strings (inclusive)", async () => {
      await exportService.exportTransactions("2026-03-01", "2026-03-31", "EUR");

      expect(vi.mocked(db.transactions.where)).toHaveBeenCalledWith("date");
      expect(mockTxQuery.between).toHaveBeenCalledWith("2026-03-01", "2026-03-31", true, true);
    });
  });

  describe("browser download trigger", () => {
    it("creates an anchor element and calls click() to initiate download", async () => {
      mockTxQuery.sortBy.mockResolvedValue([makeTx({ id: 1 })]);

      await exportService.exportTransactions("2026-04-01", "2026-04-30", "USD");

      expect(document.createElement).toHaveBeenCalledWith("a");
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(
        vi.mocked(document.createElement as any).mock.results[0].value.click,
      ).toHaveBeenCalledTimes(1);
    });

    it("sets the correct download filename", async () => {
      const clickMock = vi.fn();
      const anchor = { href: "", download: "", click: clickMock } as unknown as HTMLAnchorElement;
      vi.spyOn(document, "createElement").mockReturnValue(anchor);

      mockTxQuery.sortBy.mockResolvedValue([makeTx({ id: 1 })]);

      await exportService.exportTransactions("2026-04-01", "2026-04-30", "USD");

      expect(anchor.download).toBe("expenses_2026-04-01_to_2026-04-30.xlsx");
    });
  });

  describe("formula injection sanitization", () => {
    it("sanitizes = prefix injection strings in note field", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", note: "=SUM(A1)", amountMainCurrency: 1000 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      // col 2 = Note
      expect(sheetData[1][2]).toBe("'=SUM(A1)");
    });

    it("sanitizes + prefix injection strings", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", note: "+CMD", amountMainCurrency: 500 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      expect(sheetData[1][2]).toBe("'+CMD");
    });

    it("sanitizes - prefix injection strings", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", note: "-1+2", amountMainCurrency: 500 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      expect(sheetData[1][2]).toBe("'-1+2");
    });
  });

  describe("date formatting", () => {
    it("formats dates as dd.MM.yyyy", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", date: "2026-01-15", amountMainCurrency: 1000 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      // col 0 = Date
      expect(sheetData[1][0]).toBe("15.01.2026");
    });
  });

  describe("header row", () => {
    it("includes the main currency in the Amount column header", async () => {
      await exportService.exportTransactions("2026-04-01", "2026-04-30", "JPY");

      const expenseSheet = await getExpensesSheetData();
      const incomeSheet = await getIncomesSheetData();
      expect(expenseSheet[0]).toContain("Amount (JPY)");
      expect(incomeSheet[0]).toContain("Amount (JPY)");
    });

    it("Expenses sheet has 4 columns in the correct order", async () => {
      await exportService.exportTransactions("2026-01-01", "2026-01-31", "EUR");

      const sheetData = await getExpensesSheetData();
      expect(sheetData[0]).toEqual(["Date", "Amount (EUR)", "Note", "Category"]);
    });

    it("Incomes sheet has 4 columns in the correct order", async () => {
      await exportService.exportTransactions("2026-01-01", "2026-01-31", "EUR");

      const sheetData = await getIncomesSheetData();
      expect(sheetData[0]).toEqual(["Date", "Amount (EUR)", "Note", "Category"]);
    });
  });

  describe("name resolution", () => {
    it("resolves category name in the category column", async () => {
      mockTxQuery.sortBy.mockResolvedValue([
        makeTx({ type: "EXPENSE", categoryId: 1, amountMainCurrency: 500 }),
      ]);

      await exportService.exportTransactions("2026-01-01", "2026-01-31", "USD");

      const sheetData = await getExpensesSheetData();
      // col 3 = Category
      expect(sheetData[1][3]).toBe("Food");
    });
  });

  describe("error handling", () => {
    it("re-throws on DB error", async () => {
      mockTxQuery.sortBy.mockRejectedValue(new Error("DB read failed"));

      await expect(
        exportService.exportTransactions("2026-01-01", "2026-01-31", "USD"),
      ).rejects.toThrow("DB read failed");
    });
  });
});
