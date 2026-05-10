import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── Fixture helpers ────────────────────────────────────────────────────────────

/**
 * Seed the DB with one Regular account and one Expense category.
 * Returns the seeded IDs: { accountId, categoryId }
 */
async function seedLargeAmountFixtures(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    return new Promise<{ accountId: number; categoryId: number }>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        const accReq = tx.objectStore("accounts").add({
          name: "Big Wallet",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 0,
          startingBalance: 0,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        let accountId: number;
        let categoryId: number;

        accReq.onsuccess = () => {
          accountId = accReq.result as number;

          const catReq = tx.objectStore("categories").add({
            name: "Max Test Category",
            type: "EXPENSE",
            color: "oklch(70% 0.15 200)",
            icon: "ShoppingCart",
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

/**
 * Seed the DB with one Regular account, one Expense category, and one Budget
 * entry at maximum planned amount. Returns the seeded IDs.
 */
async function seedLargeAmountWithBudget(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    return new Promise<{ accountId: number; categoryId: number }>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories", "budgets"], "readwrite");
        const now = new Date().toISOString();
        const month = new Date().toISOString().slice(0, 7); // e.g. "2026-05"

        const accReq = tx.objectStore("accounts").add({
          name: "Big Wallet",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 0,
          startingBalance: 0,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        let accountId: number;
        let categoryId: number;

        accReq.onsuccess = () => {
          accountId = accReq.result as number;

          const catReq = tx.objectStore("categories").add({
            name: "Max Test Category",
            type: "EXPENSE",
            color: "oklch(70% 0.15 200)",
            icon: "ShoppingCart",
            displayOrder: 0,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          catReq.onsuccess = () => {
            categoryId = catReq.result as number;

            tx.objectStore("budgets").add({
              categoryId,
              accountId: null,
              month,
              plannedAmount: 99_999_999_999,
              createdAt: now,
              updatedAt: now,
            });
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

// ── TC-L01 (P0): Overflow toast on transaction numpad ─────────────────────────

test("TC-L01: amount exceeding max shows toast and does not navigate away", async ({ page }) => {
  await setup(page);
  await seedLargeAmountFixtures(page);

  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Select account and category
  await page.getByRole("button", { name: "Big Wallet" }).click();
  await page.getByRole("button", { name: "Max Test Category" }).click();

  // Type 9999999999 (10 nines) — evaluates to $9,999,999,999 which exceeds the cap
  for (let i = 0; i < 10; i++) {
    await page.locator('button[aria-label="9"]').click();
  }

  // Attempt to save
  await page.locator('button[aria-label="save"]').click();

  // Toast with overflow error message should appear
  await expect(page.getByText("Amount exceeds the maximum allowed value")).toBeVisible({
    timeout: 4000,
  });

  // Should remain on the new transaction page (save was blocked)
  await expect(page).toHaveURL(/\/transactions\/new/);
});

// ── TC-L02 (P0): Two max-amount transactions render correctly across all tabs ──

test("TC-L02: two max-amount transactions display correctly on all tabs without crash", async ({
  page,
}) => {
  // Capture JS errors thrown during the test
  const jsErrors: string[] = [];
  page.on("pageerror", (err) => jsErrors.push(err.message));

  await setup(page);
  await seedLargeAmountWithBudget(page);

  // ── First max transaction ──────────────────────────────────────────────────

  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await page.getByRole("button", { name: "Big Wallet" }).click();
  await page.getByRole("button", { name: "Max Test Category" }).click();

  // Enter 999999999.99 — nine 9s, decimal, two 9s
  for (let i = 0; i < 9; i++) {
    await page.locator('button[aria-label="9"]').click();
  }
  await page.locator('button[aria-label="decimal point"]').click();
  await page.locator('button[aria-label="9"]').click();
  await page.locator('button[aria-label="9"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });

  // ── Second max transaction ─────────────────────────────────────────────────

  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await page.getByRole("button", { name: "Big Wallet" }).click();
  await page.getByRole("button", { name: "Max Test Category" }).click();

  for (let i = 0; i < 9; i++) {
    await page.locator('button[aria-label="9"]').click();
  }
  await page.locator('button[aria-label="decimal point"]').click();
  await page.locator('button[aria-label="9"]').click();
  await page.locator('button[aria-label="9"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });

  // ── Transactions tab: both amounts visible ────────────────────────────────

  await expect(page.getByText(/999,999,999/).first()).toBeVisible();

  // ── Budget tab ────────────────────────────────────────────────────────────

  await goToTab(page, "Budget", /\/budget/);
  await expect(page.getByText("Max Test Category").first()).toBeVisible();

  // ── Overview tab ─────────────────────────────────────────────────────────

  // Wait for any view-transition animation from Budget navigation to settle
  await page.waitForTimeout(400);
  await goToTab(page, "Overview", /\/overview/);
  // Both max transactions were expenses, so the net is a large negative number containing "999"
  await expect(page.getByText(/999/).first()).toBeVisible();

  // ── Categories tab (checked last — dnd-kit on this page can block nav) ───

  await page.waitForTimeout(400);
  await goToTab(page, "Categories", /\/categories/);
  await expect(page.getByText("Max Test Category").first()).toBeVisible();

  // No unhandled JS errors should have occurred across all tabs
  expect(jsErrors).toHaveLength(0);
});
