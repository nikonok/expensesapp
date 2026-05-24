// Covers: bulk-deleting multiple transactions via SelectionToolbar correctly reverts all balance changes
import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── IDB helpers ───────────────────────────────────────────────────────────────

interface SeedResult {
  accountId: number;
  categoryId: number;
}

async function seedAccountAndCategory(page: import("@playwright/test").Page): Promise<SeedResult> {
  return page.evaluate(() => {
    return new Promise<SeedResult>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        let accountId: number;
        let categoryId: number;

        const accReq = tx.objectStore("accounts").add({
          name: "Test Wallet",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 100000, // $1000.00
          startingBalance: 100000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        accReq.onsuccess = () => {
          accountId = accReq.result as number;

          const catReq = tx.objectStore("categories").add({
            name: "Food",
            type: "EXPENSE",
            color: "oklch(62% 0.28 18)",
            icon: "utensils",
            displayOrder: 0,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          catReq.onsuccess = () => {
            categoryId = catReq.result as number;
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ accountId, categoryId });
        };
        tx.onerror = () => reject(tx.error);
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

async function getTransactionCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("transactions", "readonly");
        const r = tx.objectStore("transactions").count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Create an expense via the UI.
 * digits is an array of aria-label values to tap on the numpad.
 */
async function createExpense(
  page: import("@playwright/test").Page,
  digits: string[],
): Promise<void> {
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick FROM account
  await page.getByRole("button", { name: "Test Wallet" }).click();

  // Step 2: pick category
  await page.getByRole("button", { name: "Food" }).click({ force: true });

  // Step 3: enter amount
  for (const d of digits) {
    await page.locator(`button[aria-label="${d}"]`).click();
  }

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(200);
}

// ── TC-BD01: Bulk delete 3 transactions reverts all balance changes ────────────

test("TC-BD01: bulk-deleting 3 expense transactions reverts all balance changes", async ({
  page,
}) => {
  test.setTimeout(60000);

  await setup(page);
  const { accountId } = await seedAccountAndCategory(page);

  // Create 3 expense transactions: $10, $20, $30
  await createExpense(page, ["1", "0"]); // $10 = 1000 minor units
  await createExpense(page, ["2", "0"]); // $20 = 2000 minor units
  await createExpense(page, ["3", "0"]); // $30 = 3000 minor units

  // Verify account balance = $940.00 = 94000 minor units
  const balanceAfterCreate = await getAccountBalance(page, accountId);
  expect(balanceAfterCreate).toBe(94000); // 100000 - 1000 - 2000 - 3000

  // Verify 3 transactions exist in IDB
  const countAfterCreate = await getTransactionCount(page);
  expect(countAfterCreate).toBe(3);

  // Navigate to Transactions tab and select all 3 transactions
  await goToTab(page, "Transactions", /\/transactions/);

  // Transaction rows are rendered as <button> elements (the tap zone inside each TransactionRow).
  // Filter by 'Food' category text to target expense rows specifically.
  const rows = page.locator("button").filter({ hasText: "Food" });

  // Wait for transaction rows to be visible
  await rows.first().waitFor({ state: "visible", timeout: 5000 });

  // Select all 3 transactions by clicking each row
  const allRows = await rows.all();
  for (const row of allRows) {
    await row.click({ force: true });
    await page.waitForTimeout(100);
  }

  // The SelectionToolbar should now show with "Remove" button
  await expect(page.locator('button[aria-label="Remove selected transactions"]')).toBeVisible({
    timeout: 5000,
  });

  // Tap Remove
  await page.locator('button[aria-label="Remove selected transactions"]').click();

  // Confirm the removal dialog
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible({
    timeout: 5000,
  });
  await page.getByRole("button", { name: "Remove", exact: true }).click();

  await page.waitForTimeout(500);

  // Verify account balance is back to $1000.00 = 100000 minor units
  const balanceAfterDelete = await getAccountBalance(page, accountId);
  expect(balanceAfterDelete).toBe(100000);

  // Verify 0 transactions remain in IDB
  const countAfterDelete = await getTransactionCount(page);
  expect(countAfterDelete).toBe(0);

  // Empty state should be visible
  await expect(page.getByRole("heading", { name: "No transactions" })).toBeVisible();
});
