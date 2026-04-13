import { test, expect } from "@playwright/test";
import { setup } from "./helpers";

/**
 * Seed a regular account and a mortgage account directly into IndexedDB.
 * Returns { sourceId, mortgageId }.
 *
 * Doing this via IDB is far more reliable than clicking through
 * the multi-step numpad form in the UI.
 */
async function seedAccounts(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    return new Promise<{ sourceId: number; mortgageId: number }>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("accounts", "readwrite");
        const store = tx.objectStore("accounts");
        const now = new Date().toISOString();

        // Regular source account with 50,000 balance (stored as cents)
        const sourceReq = store.add({
          name: "Test Account",
          type: "REGULAR",
          color: "oklch(72% 0.22 210)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 5000000,
          startingBalance: 5000000,
          includeInTotal: true,
          isTrashed: false,
          savingsGoal: null,
          savingsInterestRate: null,
          interestRateMonthly: null,
          interestRateYearly: null,
          debtOriginalAmount: null,
          mortgageLoanAmount: null,
          mortgageStartDate: null,
          mortgageTermYears: null,
          mortgageInterestRate: null,
          createdAt: now,
          updatedAt: now,
        });

        sourceReq.onsuccess = () => {
          const sourceId = sourceReq.result as number;

          // Mortgage account:
          //   originalLoan = 400,000 → stored as cents = 40,000,000
          //   alreadyPaid  = 20,000  → remaining balance = 380,000 → -38,000,000 cents
          //   term         = 25 years
          //   rate         = 5% annual → stored as 0.05
          const mortgageReq = store.add({
            name: "Test Mortgage",
            type: "DEBT",
            color: "oklch(72% 0.22 30)",
            icon: "home",
            currency: "USD",
            description: "",
            balance: -38000000,
            startingBalance: -38000000,
            includeInTotal: true,
            isTrashed: false,
            savingsGoal: null,
            savingsInterestRate: null,
            interestRateMonthly: null,
            interestRateYearly: null,
            debtOriginalAmount: 40000000,
            mortgageLoanAmount: 40000000,
            mortgageStartDate: "2020-01-01",
            mortgageTermYears: 25,
            mortgageInterestRate: 0.05,
            createdAt: now,
            updatedAt: now,
          });

          mortgageReq.onsuccess = () => {
            const mortgageId = mortgageReq.result as number;
            tx.oncomplete = () => {
              db.close();
              resolve({ sourceId, mortgageId });
            };
            tx.onerror = () => reject(tx.error);
          };
          mortgageReq.onerror = () => reject(mortgageReq.error);
        };
        sourceReq.onerror = () => reject(sourceReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// ── TC: Mortgage overpayment shows "Saves N months" hint ──────────────────────

test("mortgage overpayment shows term savings hint", async ({ page }) => {
  test.setTimeout(30000);

  await setup(page);

  // Seed test accounts directly via IDB (avoids complex numpad UI)
  await seedAccounts(page);

  // Reload so Dexie picks up the newly seeded accounts
  await page.reload();
  await page.waitForURL(/\/accounts/);

  // Both accounts should now be visible in the list
  await expect(page.getByText("Test Account")).toBeVisible();
  await expect(page.getByText("Test Mortgage")).toBeVisible();

  // Open the new transaction form
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/);

  // ── Step 1: select source account ─────────────────────────────────────────
  // Step 1 shows non-debt accounts; click "Test Account"
  await expect(page.getByRole("button", { name: /Test Account/i })).toBeVisible();
  await page.getByRole("button", { name: /Test Account/i }).click();

  // ── Step 2: select mortgage as debt payment destination ───────────────────
  // Step 2 shows debt accounts (with DEBT chip) and expense categories.
  // "Test Mortgage" should appear as a debt account option.
  await expect(page.getByRole("button", { name: /Test Mortgage/i })).toBeVisible();
  await page.getByRole("button", { name: /Test Mortgage/i }).click();

  // ── Step 3: detail form — enter an amount and switch to Overpayment ───────
  // Enter 10,000 via the numpad (100, 0, 0 → 10,000.00)
  await page.locator('button[aria-label="1"]').click();
  await page.locator('button[aria-label="0"]').click();
  await page.locator('button[aria-label="0"]').click();
  await page.locator('button[aria-label="0"]').click();
  await page.locator('button[aria-label="0"]').click();

  // The regular/overpayment toggle should be visible because we're in debt payment mode
  await expect(page.getByRole("button", { name: "Overpayment" })).toBeVisible();

  // Switch to Overpayment mode
  await page.getByRole("button", { name: "Overpayment" }).click();

  // ── Assert: "Saves N months" hint is displayed ────────────────────────────
  await expect(page.getByText(/Saves \d+ month/)).toBeVisible();
});
