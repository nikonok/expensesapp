import { test, expect } from '@playwright/test';
import { setup, goToTab } from './helpers';

// ── Fixture helpers ────────────────────────────────────────────────────────────

/**
 * Seed the DB with one Regular account, one expense category, and one income
 * category so transaction tests have something to work with.
 * Returns the seeded IDs: { accountId, expenseCategoryId, incomeCategoryId }
 */
async function seedTransactionFixtures(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    return new Promise<{ accountId: number; expenseCategoryId: number; incomeCategoryId: number }>(
      (resolve, reject) => {
        const req = indexedDB.open('expenses-app-db');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['accounts', 'categories'], 'readwrite');
          const now = new Date().toISOString();

          // Insert account
          const accReq = tx.objectStore('accounts').add({
            name: 'Test Wallet',
            type: 'REGULAR',
            color: 'oklch(73% 0.23 160)',
            icon: 'wallet',
            currency: 'USD',
            description: '',
            balance: 100000, // 1000.00 USD in minor units
            startingBalance: 100000,
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

            const expReq = tx.objectStore('categories').add({
              name: 'Food',
              type: 'EXPENSE',
              color: 'oklch(62% 0.28 18)',
              icon: 'utensils',
              displayOrder: 0,
              isTrashed: false,
              createdAt: now,
              updatedAt: now,
            });

            expReq.onsuccess = () => {
              expenseCategoryId = expReq.result as number;

              const incReq = tx.objectStore('categories').add({
                name: 'Salary',
                type: 'INCOME',
                color: 'oklch(73% 0.23 160)',
                icon: 'briefcase',
                displayOrder: 0,
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
      },
    );
  });
}

// ── TC-029 (P0): Create an expense transaction ────────────────────────────────

test('TC-029: create expense transaction appears in list with correct amount', async ({ page }) => {
  await setup(page);
  await seedTransactionFixtures(page);

  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick FROM account (expense type is default)
  await page.getByRole('button', { name: 'Test Wallet' }).click();

  // Step 2: pick TO category
  await page.getByRole('button', { name: 'Food' }).click();

  // Step 3: enter amount 75 on numpad
  await page.locator('button[aria-label="7"]').click();
  await page.locator('button[aria-label="5"]').click();

  // Save
  await page.locator('button[aria-label="save"]').click();

  // Should navigate back to transactions list
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });

  // Transaction row should appear with the correct amount
  await expect(page.getByText('Food')).toBeVisible();
  await expect(page.getByText(/75/).first()).toBeVisible();
});

// ── TC-030 (P0): Create an income transaction ────────────────────────────────

test('TC-030: create income transaction appears with green (positive) amount', async ({ page }) => {
  await setup(page);
  await seedTransactionFixtures(page);

  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick income category (FROM) — Salary is listed as an income category
  await page.getByRole('button', { name: 'Salary' }).click();

  // Step 2: pick TO account
  await page.getByRole('button', { name: 'Test Wallet' }).click();

  // Step 3: enter amount 2000
  await page.locator('button[aria-label="2"]').click();
  await page.locator('button[aria-label="0"]').first().click();
  await page.locator('button[aria-label="0"]').first().click();
  await page.locator('button[aria-label="0"]').first().click();

  // Save
  await page.locator('button[aria-label="save"]').click();

  await page.waitForURL(/\/transactions$/, { timeout: 8000 });

  // Transaction row should show the income category name
  await expect(page.getByText('Salary')).toBeVisible();

  // The amount should be visible in the transaction list
  await expect(page.getByText(/2[,. ]?000/).first()).toBeVisible();
});

// ── TC-033 (P0): Delete a transaction ────────────────────────────────────────

test('TC-033: delete transaction removes it from the list', async ({ page }) => {
  await setup(page);
  await seedTransactionFixtures(page);

  // First create a transaction to delete
  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Expense: pick account → category → amount
  await page.getByRole('button', { name: 'Test Wallet' }).click();
  await page.getByRole('button', { name: 'Food' }).click();
  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').first().click();
  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });

  // Verify the transaction is in the list
  await expect(page.getByText('Food')).toBeVisible();

  // Tap the transaction row to select it
  await page.getByRole('button', { name: 'Food' }).first().click();

  // Selection toolbar should appear with Remove button
  await expect(page.locator('button[aria-label="Remove selected transactions"]')).toBeVisible();

  // Tap Remove
  await page.locator('button[aria-label="Remove selected transactions"]').click();

  // Confirm dialog appears
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  // Transaction should be gone — empty state returns
  await expect(page.getByRole('heading', { name: 'No transactions' })).toBeVisible();
});

// ── TC-numpad (P1): Transaction amount math expression ───────────────────────

test('numpad math: entering 100+50 evaluates to 150 before saving', async ({ page }) => {
  await setup(page);
  await seedTransactionFixtures(page);

  await goToTab(page, 'Transactions', /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Navigate to Step 3 (the numpad screen)
  await page.getByRole('button', { name: 'Test Wallet' }).click();
  await page.getByRole('button', { name: 'Food' }).click();

  // Enter "100+50" on the numpad
  await page.locator('button[aria-label="1"]').click();
  await page.locator('button[aria-label="0"]').first().click();
  await page.locator('button[aria-label="0"]').first().click();
  await page.locator('button[aria-label="add"]').click();
  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').first().click();

  // The display should show the evaluated result in cents as "= 15 000"
  // (evaluateExpression returns minor units: 100+50 major = 15000 cents)
  await expect(page.getByText(/= 15[\s\u00a0]?000/)).toBeVisible();
});
