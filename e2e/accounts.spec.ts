import { test, expect } from '@playwright/test';
import { setup } from './helpers';

// Helper: open the "New Account" form from the FAB
async function openNewAccountForm(page: import('@playwright/test').Page) {
  await page.locator('button[aria-label="Add account"]').click();
  await expect(page.locator('input#acc-name')).toBeVisible();
}

// Helper: set starting balance via the Numpad overlay
async function setStartingBalance(page: import('@playwright/test').Page, amount: string) {
  // Click the starting balance button (shows "0.00" by default)
  await page.getByText('Starting Balance').locator('..').locator('button').click();
  // Type each digit
  for (const ch of amount) {
    if (ch === '.') {
      await page.locator('button[aria-label="decimal point"]').click();
    } else {
      await page.locator(`button[aria-label="${ch}"]`).click();
    }
  }
  await page.locator('button[aria-label="save"]').click();
}

// ── TC-007 (P0): Create a Regular account ─────────────────────────────────────

test('TC-007: create Regular account shows card in list', async ({ page }) => {
  await setup(page);

  // Empty state should be visible initially
  await expect(page.getByRole('heading', { name: 'No accounts yet' })).toBeVisible();

  await openNewAccountForm(page);

  // Type should already be "Regular" by default — just fill the name
  await page.fill('input#acc-name', 'Cash Wallet');

  // Set starting balance to 200
  await setStartingBalance(page, '200');

  // Submit
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Account card should appear
  await expect(page.getByText('Cash Wallet')).toBeVisible();

  // Empty state should be gone
  await expect(page.getByRole('heading', { name: 'No accounts yet' })).not.toBeVisible();
});

// ── TC-009 (P1): Create a Debt account ────────────────────────────────────────

test('TC-009: create Debt account with interest rate', async ({ page }) => {
  await setup(page);

  await openNewAccountForm(page);

  // Switch to Debt type
  await page.getByRole('button', { name: 'Debt' }).click();

  // Fill name
  await page.fill('input#acc-name', 'Credit Card');

  // Fill yearly interest rate
  await page.fill('input#interest-yearly', '18.5');

  // Submit
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Account card with name should appear
  await expect(page.getByText('Credit Card')).toBeVisible();

  // The "Debt" type chip should be visible on the card
  await expect(page.getByText('Debt').first()).toBeVisible();
});

// ── TC-013 (P1): Soft delete (archive) an account ─────────────────────────────

test('TC-013: archive account removes it from the active list', async ({ page }) => {
  await setup(page);

  // First create an account to archive
  await openNewAccountForm(page);
  await page.fill('input#acc-name', 'Test Account');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByText('Test Account')).toBeVisible();

  // Tap the account card to open AccountDetail
  await page.locator('button', { hasText: 'Test Account' }).click();

  // Tap "Archive Account" button inside the detail sheet
  await expect(page.getByRole('button', { name: 'Archive Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive Account' }).click();

  // Confirm dialog appears — tap the "Archive" confirm button (exact match to avoid
  // matching "Archive Account" or the "View archived accounts" filter button)
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();

  // Empty state should return — confirms account was removed from the active list
  await expect(page.getByRole('heading', { name: 'No accounts yet' })).toBeVisible();
});
