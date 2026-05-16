import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── Fixture helpers ────────────────────────────────────────────────────────────

interface FixtureIds {
  accountId: number;
  expenseCategoryId: number;
  incomeCategoryId: number;
}

/**
 * Seed the DB with one Regular account at a given starting balance,
 * plus one expense and one income category.
 */
async function seedFixtures(
  page: import("@playwright/test").Page,
  startingBalance: number,
): Promise<FixtureIds> {
  return page.evaluate((balance: number) => {
    return new Promise<FixtureIds>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        const accReq = tx.objectStore("accounts").add({
          name: "Test Wallet",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: balance,
          startingBalance: balance,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        let accountId: number;
        let expenseCategoryId: number;
        let incomeCategoryId: number;

        accReq.onsuccess = () => {
          accountId = accReq.result as number;

          const expReq = tx.objectStore("categories").add({
            name: "Food",
            type: "EXPENSE",
            color: "oklch(62% 0.28 18)",
            icon: "utensils",
            displayOrder: 0,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          expReq.onsuccess = () => {
            expenseCategoryId = expReq.result as number;

            const incReq = tx.objectStore("categories").add({
              name: "Salary",
              type: "INCOME",
              color: "oklch(73% 0.23 160)",
              icon: "briefcase",
              displayOrder: 1,
              isTrashed: false,
              createdAt: now,
              updatedAt: now,
            });

            incReq.onsuccess = () => {
              incomeCategoryId = incReq.result as number;
            };
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ accountId, expenseCategoryId, incomeCategoryId });
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, startingBalance);
}

/** Read the balance for a given account id from IndexedDB. */
async function getAccountBalance(
  page: import("@playwright/test").Page,
  accountId: number,
): Promise<number> {
  return page.evaluate((id: number) => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("accounts", "readonly");
        const getReq = tx.objectStore("accounts").get(id);
        getReq.onsuccess = () => resolve((getReq.result as { balance: number }).balance);
        getReq.onerror = () => reject(getReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, accountId);
}

/** Read the most recent transaction's amount from IndexedDB (by auto-increment id). */
async function getLastTransactionAmount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("transactions", "readonly");
        const store = tx.objectStore("transactions");
        // Open cursor from end — last key is the most recently inserted row
        const cursorReq = store.openCursor(null, "prev");
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            resolve((cursor.value as { amount: number }).amount);
          } else {
            reject(new Error("No transactions found in IDB"));
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Create an expense transaction via the UI.
 * Navigates to /transactions/new, picks account → category → digits, then saves.
 * Digits is an array of aria-label values (e.g. ["7", "5"] for 75).
 */
async function createExpense(
  page: import("@playwright/test").Page,
  digits: string[],
): Promise<void> {
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1 — pick account (expense is the default tab)
  await page.getByRole("button", { name: "Test Wallet" }).click();

  // Step 2 — pick category
  await page.getByRole("button", { name: "Food" }).click();

  // Step 3 — enter amount
  for (const d of digits) {
    await page.locator(`button[aria-label="${d}"]`).click();
  }

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
}

/**
 * Create an income transaction via the UI.
 * On Step 1 the income category (Salary) is picked first, then the account.
 */
async function createIncome(
  page: import("@playwright/test").Page,
  digits: string[],
): Promise<void> {
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1 — pick income category (FROM side for income)
  await page.getByRole("button", { name: "Salary" }).click();

  // Step 2 — pick account (TO side)
  await page.getByRole("button", { name: "Test Wallet" }).click();

  // Step 3 — enter amount
  for (const d of digits) {
    await page.locator(`button[aria-label="${d}"]`).click();
  }

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
}

// ── TC-B01: Balance decreases after expense ────────────────────────────────────

test("TC-B01: balance decreases after expense", async ({ page }) => {
  await setup(page);
  const { accountId } = await seedFixtures(page, 10000); // $100.00

  await createExpense(page, ["7", "5"]); // $75

  const balance = await getAccountBalance(page, accountId);
  expect(balance).toBe(2500); // 10000 - 7500
});

// ── TC-B02: Balance increases after income ─────────────────────────────────────

test("TC-B02: balance increases after income", async ({ page }) => {
  await setup(page);
  const { accountId } = await seedFixtures(page, 5000); // $50.00

  await createIncome(page, ["3", "0"]); // $30

  const balance = await getAccountBalance(page, accountId);
  expect(balance).toBe(8000); // 5000 + 3000
});

// ── TC-B03: Balance updates correctly when transaction is edited ───────────────

test("TC-B03: balance updates correctly when transaction is edited", async ({ page }) => {
  await setup(page);
  const { accountId } = await seedFixtures(page, 10000); // $100.00

  // Create expense of $75 → balance should become 2500
  await createExpense(page, ["7", "5"]);

  const balanceAfterCreate = await getAccountBalance(page, accountId);
  expect(balanceAfterCreate).toBe(2500);

  // Read the transaction id from IDB (most recent row by auto-increment cursor)
  const txId = await page.evaluate(() => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("transactions", "readonly");
        const cursorReq = tx.objectStore("transactions").openCursor(null, "prev");
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            resolve((cursor.value as { id: number }).id);
          } else {
            reject(new Error("No transactions in IDB"));
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Navigate client-side to the edit route — avoids the cold-start redirect
  // that page.goto() triggers (startup logic redirects to startupScreen tab).
  await page.evaluate((id: number) => {
    window.history.pushState({}, "", `/transactions/${id}/edit`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, txId);
  await page.waitForURL(/\/transactions\/\d+\/edit/, { timeout: 8000 });

  // The edit form starts at the numpad step (step 3) pre-filled with 75.
  // Backspace twice to clear "75", then enter 50.
  const backspace = page.locator('button[aria-label="backspace"]');
  await backspace.click();
  await backspace.click();

  // Enter new amount: 50
  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').first().click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });

  const balanceAfterEdit = await getAccountBalance(page, accountId);
  // replaceTransaction must reverse the old $75 and apply $50: 10000 - 5000 = 5000
  expect(balanceAfterEdit).toBe(5000);
});

// ── TC-B04: Balance reverts when transaction is deleted ────────────────────────

test("TC-B04: balance reverts when transaction is deleted", async ({ page }) => {
  await setup(page);
  const { accountId } = await seedFixtures(page, 10000); // $100.00

  await createExpense(page, ["7", "5"]); // $75 → balance 2500

  const balanceAfterCreate = await getAccountBalance(page, accountId);
  expect(balanceAfterCreate).toBe(2500);

  // Select the transaction row and delete it
  await page.getByRole("button", { name: "Food" }).first().click();
  await expect(
    page.locator('button[aria-label="Remove selected transactions"]'),
  ).toBeVisible();
  await page.locator('button[aria-label="Remove selected transactions"]').click();

  // Confirm the removal
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();

  // Empty state should appear
  await expect(page.getByRole("heading", { name: "No transactions" })).toBeVisible();

  // Balance should be fully reverted
  const balanceAfterDelete = await getAccountBalance(page, accountId);
  expect(balanceAfterDelete).toBe(10000);
});

// ── TC-B05: Stored transaction amount is in minor units ────────────────────────

test("TC-B05: stored transaction amount is in minor units (7500 not 75)", async ({ page }) => {
  await setup(page);
  await seedFixtures(page, 0);

  await createExpense(page, ["7", "5"]); // enter "75" on the numpad

  const amount = await getLastTransactionAmount(page);
  expect(amount).toBe(7500); // minor units, NOT 75
});
