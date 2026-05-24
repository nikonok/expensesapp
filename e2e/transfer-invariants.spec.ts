// Covers: transfer creates exactly 2 transaction records with shared transferGroupId and opposite transferDirection; transfers excluded from Overview income/expense totals
import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── IDB helpers ───────────────────────────────────────────────────────────────

interface SeedResult {
  accountAId: number;
  accountBId: number;
}

async function seedTwoRegularAccounts(page: import("@playwright/test").Page): Promise<SeedResult> {
  return page.evaluate(() => {
    return new Promise<SeedResult>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        let accountAId: number;
        let accountBId: number;

        const reqA = tx.objectStore("accounts").add({
          name: "Source Account",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 20000, // $200.00
          startingBalance: 20000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        reqA.onsuccess = () => {
          accountAId = reqA.result as number;

          const reqB = tx.objectStore("accounts").add({
            name: "Destination Account",
            type: "REGULAR",
            color: "oklch(62% 0.28 18)",
            icon: "credit-card",
            currency: "USD",
            description: "",
            balance: 10000, // $100.00
            startingBalance: 10000,
            includeInTotal: true,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          reqB.onsuccess = () => {
            accountBId = reqB.result as number;

            // Seed a dummy expense category so the TransactionInput guard passes
            tx.objectStore("categories").add({
              name: "Transfer",
              type: "EXPENSE",
              color: "oklch(73% 0.23 160)",
              icon: "arrow-left-right",
              displayOrder: 0,
              isTrashed: false,
              createdAt: now,
              updatedAt: now,
            });
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ accountAId, accountBId });
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

interface TransactionRecord {
  id: number;
  type: string;
  transferGroupId: string | null;
  transferDirection: string | null;
  amount: number;
}

async function getAllTransactions(
  page: import("@playwright/test").Page,
): Promise<TransactionRecord[]> {
  return page.evaluate(() => {
    return new Promise<TransactionRecord[]>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("transactions", "readonly");
        const all: TransactionRecord[] = [];
        const r = tx.objectStore("transactions").openCursor();
        r.onsuccess = () => {
          const cursor = r.result;
          if (cursor) {
            all.push(cursor.value as TransactionRecord);
            cursor.continue();
          } else {
            resolve(all);
          }
        };
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function getAccountBalance(
  page: import("@playwright/test").Page,
  id: number,
): Promise<number> {
  return page.evaluate((accountId: number) => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("accounts", "readonly");
        const r = tx.objectStore("accounts").get(accountId);
        r.onsuccess = () => resolve((r.result as { balance: number }).balance);
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, id);
}

// ── TC-TI01: Transfer creates 2 records with opposite direction ───────────────

test("TC-TI01: transfer creates 2 records sharing transferGroupId with opposite direction", async ({
  page,
}) => {
  await setup(page);
  const { accountAId, accountBId } = await seedTwoRegularAccounts(page);

  // Navigate to Transactions tab and open new transaction form
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick FROM account (Source Account)
  await page.getByRole("button", { name: "Source Account" }).click();

  // Step 2: pick TO account (Destination Account — displayed with TRANSFER chip)
  await page.getByRole("button", { name: "Destination Account" }).click({ force: true });

  // Step 3: enter $50.00 — numpad works in major units
  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Assert exactly 2 transaction records exist
  const txs = await getAllTransactions(page);
  expect(txs).toHaveLength(2);

  // Assert both share a non-null transferGroupId
  const groupId = txs[0].transferGroupId;
  expect(groupId).not.toBeNull();
  expect(txs[1].transferGroupId).toBe(groupId);

  // Assert opposite transferDirection values
  const directions = new Set(txs.map((t) => t.transferDirection));
  expect(directions).toContain("OUT");
  expect(directions).toContain("IN");

  // Assert source balance decreased by 5000 minor units ($50.00)
  const srcBalance = await getAccountBalance(page, accountAId);
  expect(srcBalance).toBe(15000); // 20000 - 5000

  // Assert destination balance increased by 5000 minor units
  const dstBalance = await getAccountBalance(page, accountBId);
  expect(dstBalance).toBe(15000); // 10000 + 5000
});

// ── TC-TI02: Transfer is excluded from Overview income/expense totals ─────────

test("TC-TI02: transfer amount is excluded from Overview income and expense totals", async ({
  page,
}) => {
  await setup(page);
  await seedTwoRegularAccounts(page);

  // Create the $50 transfer via UI
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await page.getByRole("button", { name: "Source Account" }).click();
  await page.getByRole("button", { name: "Destination Account" }).click({ force: true });

  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Navigate to Overview tab
  await goToTab(page, "Overview", /\/overview/);
  await page.waitForTimeout(400);

  // The Overview should show no data (only a transfer, no income/expense), OR
  // if it does show totals, neither should include the transfer amount.
  // The transfer-only scenario results in "No data for this period" empty state
  // because isExpenseForReporting filters out TRANSFER type and only INCOME type counts.
  const emptyState = page.getByRole("heading", { name: "No data for this period" });
  const incomeLabel = page.locator("text=Income");

  // Either empty state is shown (transfers don't count), or income/expense totals are $0.00
  const emptyVisible = await emptyState.isVisible().catch(() => false);
  if (emptyVisible) {
    // Transfer correctly excluded — overview has no reportable data
    await expect(emptyState).toBeVisible();
  } else {
    // If summary is visible, income and expense totals must NOT include $50 = 5000 minor units
    await expect(incomeLabel.first()).toBeVisible();
    // Income display should be $0.00 (no income transactions)
    const summaryText = await page
      .locator('[style*="color-income"], [style*="color-expense"]')
      .allTextContents();
    // Transfer amounts ($50.00) should not appear in the income/expense totals
    const has50 = summaryText.some((t) => t.includes("50.00") || t.includes("$50"));
    expect(has50).toBe(false);
  }
});
