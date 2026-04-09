import { test, expect } from '@playwright/test';

// Helper: wipe all IndexedDB data so each test starts from a clean slate.
// Must navigate to the app first (about:blank doesn't have IndexedDB access).
async function clearDB(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300); // give Dexie time to open the DB
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('expenses-app-db');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });
  await page.reload();
}

// Helper: read all accounts from IndexedDB
async function getAccounts(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('expenses-app-db');
    return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('accounts', 'readonly');
        const req = tx.objectStore('accounts').getAll();
        req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
        req.onerror = () => reject(req.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

// ── Regression: onboarding account creation ───────────────────────────────────
//
// Bug: OnboardingFlow.tsx passed `handleFinish` directly as `onClick`, causing
// the MouseEvent to be received as `skipAccount`. Since a MouseEvent is truthy,
// `!skipAccount` evaluated to false and the account was silently never created.

test('onboarding: "Go to App" saves the first account to IndexedDB', async ({ page }) => {
  await clearDB(page);
  await page.waitForURL(/\/onboarding/);

  // Step 0 — welcome
  await page.getByRole('button', { name: 'Get Started' }).click();

  // Step 1 — currency (keep default USD)
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2 — account (keep default name "Cash", balance 0)
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 3 — categories (accept all)
  await page.getByRole('button', { name: 'Accept all' }).click();

  // Step 4 — complete
  await page.waitForURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: "You're all set!" })).toBeVisible();
  await page.getByRole('button', { name: 'Go to App' }).click();

  await page.waitForURL(/\/transactions/);

  const accounts = await getAccounts(page);
  expect(accounts).toHaveLength(1);
  expect(accounts[0].name).toBe('Cash');
  expect(accounts[0].type).toBe('REGULAR');
  expect(accounts[0].currency).toBe('USD');
});

test('onboarding: transaction form shows account in step 1 after onboarding', async ({ page }) => {
  await clearDB(page);
  await page.waitForURL(/\/onboarding/);

  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Next' }).click(); // currency
  await page.getByRole('button', { name: 'Next' }).click(); // account
  await page.getByRole('button', { name: 'Accept all' }).click(); // categories → complete
  await page.getByRole('button', { name: 'Go to App' }).click();
  await page.waitForURL(/\/transactions/);

  // Open new transaction form
  await page.getByLabel('Add transaction').click();
  await page.waitForURL(/\/transactions\/new/);

  // Step 1 must show the Cash account — not just income categories
  await expect(page.getByRole('button', { name: /Cash/i })).toBeVisible();
});

// ── Overview loading after first transaction ──────────────────────────────────

test('overview: loads all sections after first transaction is added', async ({ page }) => {
  await clearDB(page);
  await page.waitForURL(/\/onboarding/);

  // Complete onboarding
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await page.getByRole('button', { name: 'Go to App' }).click();
  await page.waitForURL(/\/transactions/);

  // Add an expense: Cash → Food, amount 50
  await page.getByLabel('Add transaction').click();
  await page.waitForURL(/\/transactions\/new/);
  await page.getByRole('button', { name: /Cash/i }).click();
  await page.getByRole('button', { name: 'Food' }).click();
  await page.getByRole('button', { name: '5' }).click();
  await page.getByRole('button', { name: '0' }).click();
  await page.getByRole('button', { name: 'save' }).click();
  await page.waitForURL(/\/transactions/);

  // Navigate to Overview
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.waitForURL(/\/overview/);

  // All four sections must be visible — no crash, no empty state
  await expect(page.getByText('No data for this period')).not.toBeVisible();

  // Net/expense amount rendered (the minus sign and amount are separate spans)
  await expect(page.locator('text=$50.00').first()).toBeVisible();

  // Spending chart section
  await expect(page.getByText('Spending', { exact: true })).toBeVisible();

  // Daily breakdown section
  await expect(page.getByText('Daily breakdown', { exact: true })).toBeVisible();
  await expect(page.getByText('Avg / day')).toBeVisible();

  // Category breakdown section
  await expect(page.getByText('Categories', { exact: true })).toBeVisible();
  await expect(page.getByText('Food')).toBeVisible();
});
