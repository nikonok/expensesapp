// Covers: editing a transaction's FROM account fully reverts the old account balance and applies to the new account without double-applying
import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── IDB helpers ───────────────────────────────────────────────────────────────

interface SeedResult {
  accountAId: number;
  accountBId: number;
  categoryId: number;
}

async function seedTwoAccountsAndCategory(
  page: import("@playwright/test").Page,
): Promise<SeedResult> {
  return page.evaluate(() => {
    return new Promise<SeedResult>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        let accountAId: number;
        let accountBId: number;
        let categoryId: number;

        const reqA = tx.objectStore("accounts").add({
          name: "Account A",
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

        reqA.onsuccess = () => {
          accountAId = reqA.result as number;

          const reqB = tx.objectStore("accounts").add({
            name: "Account B",
            type: "REGULAR",
            color: "oklch(62% 0.28 18)",
            icon: "credit-card",
            currency: "USD",
            description: "",
            balance: 100000, // $1000.00
            startingBalance: 100000,
            includeInTotal: true,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          reqB.onsuccess = () => {
            accountBId = reqB.result as number;

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
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ accountAId, accountBId, categoryId });
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

async function getLastTransactionId(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("transactions", "readonly");
        const r = tx.objectStore("transactions").openCursor(null, "prev");
        r.onsuccess = () => {
          const cursor = r.result;
          if (cursor) {
            resolve((cursor.value as { id: number }).id);
          } else {
            reject(new Error("No transactions in IDB"));
          }
        };
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// ── TC-EAC01: Editing a transaction's account reverts old account and applies to new ──

test("TC-EAC01: editing expense account from A to B reverts A balance and applies to B", async ({
  page,
}) => {
  await setup(page);
  const { accountAId, accountBId } = await seedTwoAccountsAndCategory(page);

  // Step 1: Create a $50 expense from Account A
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick FROM account (Account A)
  await page.getByRole("button", { name: "Account A" }).click();

  // Step 2: pick category (Food)
  await page.getByRole("button", { name: "Food" }).click({ force: true });

  // Step 3: enter $50.00 on the numpad
  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Assert Account A = $950.00 = 95000 minor units
  const balanceAAfterCreate = await getAccountBalance(page, accountAId);
  expect(balanceAAfterCreate).toBe(95000); // 100000 - 5000

  // Account B should be unchanged
  const balanceBAfterCreate = await getAccountBalance(page, accountBId);
  expect(balanceBAfterCreate).toBe(100000);

  // Step 2: Find the transaction ID in IDB
  const txId = await getLastTransactionId(page);

  // Navigate to the edit form via pushState (avoids cold-start redirect)
  await page.evaluate((id: number) => {
    window.history.pushState({}, "", `/transactions/${id}/edit`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, txId);
  await page.waitForURL(/\/transactions\/\d+\/edit/, { timeout: 8000 });
  await page.waitForTimeout(400);

  // The edit form starts at the numpad step (step 3) pre-filled with "50"
  // Open the FROM picker by clicking the button that shows "Account A"
  // In Step3, the FROM button renders the account.name as text — find it by name
  await page.locator('button[aria-label="save"]').waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400); // wait for form to fully populate

  // The FROM pill button in the header contains the account name text
  // Use a button that has "Account A" text but is NOT the "save" button
  const fromButton = page.locator("button").filter({ hasText: /^Account A$/ });
  await fromButton.first().click();

  // A picker sheet (PickerSheet) opens listing non-debt accounts; "Account B" should be visible
  await expect(page.getByRole("button", { name: "Account B" })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Account B" }).click();

  // Save the edit
  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Assert Account A is fully reverted back to $1000.00
  const balanceAAfterEdit = await getAccountBalance(page, accountAId);
  expect(balanceAAfterEdit).toBe(100000); // fully reverted

  // Assert Account B now has the $50 expense applied: $1000 - $50 = $950
  const balanceBAfterEdit = await getAccountBalance(page, accountBId);
  expect(balanceBAfterEdit).toBe(95000); // 100000 - 5000
});
