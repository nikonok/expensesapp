import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setup } from './helpers';

// ── Fixture helpers ────────────────────────────────────────────────────────────

// Seeds 1 account, 1 category, 2 transactions (EXPENSE + zero-amount TRANSFER), 1 budget, 1 exchange-rate entry.
// Zero-amount TRANSFER is the regression fixture for the old .positive() validation bug.
async function seedFixture(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('expenses-app-db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(
          ['accounts', 'categories', 'transactions', 'budgets', 'exchangeRates'],
          'readwrite',
        );
        const now = new Date().toISOString();

        tx.objectStore('accounts').put({
          id: 1,
          name: 'Test Account',
          type: 'REGULAR',
          color: 'oklch(70% 0.2 180)',
          icon: 'wallet',
          currency: 'USD',
          description: '',
          balance: 50000,
          startingBalance: 50000,
          includeInTotal: true,
          isTrashed: false,
          savingsGoal: null,
          debtOriginalAmount: null,
          mortgageLoanAmount: null,
          createdAt: now,
          updatedAt: now,
        });

        tx.objectStore('categories').put({
          id: 1,
          name: 'Groceries',
          type: 'EXPENSE',
          color: 'oklch(70% 0.2 30)',
          icon: 'shopping-cart',
          displayOrder: 0,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        tx.objectStore('transactions').put({
          id: 1,
          type: 'EXPENSE',
          date: '2026-04-10',
          timestamp: now,
          displayOrder: 0,
          accountId: 1,
          categoryId: 1,
          currency: 'USD',
          amount: 1234,
          amountMainCurrency: 1234,
          exchangeRate: 1,
          note: '',
          isTrashed: false,
          transferGroupId: null,
          transferDirection: null,
          createdAt: now,
          updatedAt: now,
        });

        // Zero-amount transfer — regression for old .positive() validation bug
        tx.objectStore('transactions').put({
          id: 2,
          type: 'TRANSFER',
          date: '2026-04-11',
          timestamp: now,
          displayOrder: 1,
          accountId: 1,
          categoryId: null,
          currency: 'USD',
          amount: 0,
          amountMainCurrency: 0,
          exchangeRate: 1,
          note: 'zero adjust',
          isTrashed: false,
          transferGroupId: '00000000-0000-0000-0000-000000000000',
          transferDirection: 'OUT',
          createdAt: now,
          updatedAt: now,
        });

        tx.objectStore('budgets').put({
          id: 1,
          categoryId: 1,
          accountId: null,
          month: '2026-04',
          plannedAmount: 50000,
          createdAt: now,
          updatedAt: now,
        });

        tx.objectStore('exchangeRates').put({
          id: 1,
          baseCurrency: 'USD',
          date: '2026-04-10',
          rates: { EUR: 0.92 },
          fetchedAt: now,
        });

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function countTxns(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('expenses-app-db');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('transactions', 'readonly');
          const countReq = tx.objectStore('transactions').count();
          countReq.onsuccess = () => {
            db.close();
            resolve(countReq.result);
          };
          countReq.onerror = () => reject(countReq.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

async function clearTxns(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('expenses-app-db');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('transactions', 'readwrite');
          tx.objectStore('transactions').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

async function openSettings(page: Page) {
  await page.locator('button[aria-label="Open settings"]').click({ force: true });
  await page.waitForURL(/\/settings/, { timeout: 8000 });
}

// ── TC-BACKUP-01: Create backup + restore round-trip ─────────────────────────

test('TC-BACKUP-01: create backup then restore round-trip restores both transactions including zero-amount', async ({
  page,
}) => {
  await setup(page);
  await seedFixture(page);

  await openSettings(page);

  // Create the backup
  await page.getByRole('button', { name: 'Create backup' }).click({ force: true });
  await expect(page.getByText('Backup created.')).toBeVisible({ timeout: 6000 });

  // Wipe transactions to simulate data loss
  await clearTxns(page);
  expect(await countTxns(page)).toBe(0);

  // Restore from backup
  await page.getByRole('button', { name: 'Restore from backup' }).click({ force: true });
  // Confirm in the destructive dialog — confirmLabel is "Restore"
  await page.getByRole('button', { name: 'Restore', exact: true }).click({ force: true });

  // App dispatches 'backup-restored' → window.location.reload()
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  // After reload the restored settings still include hasCompletedOnboarding = true
  // because it was part of the backup. Verify we land on the app (not onboarding).
  await expect(page).not.toHaveURL(/onboarding/);

  // Both transactions (including the zero-amount one) must be present
  expect(await countTxns(page)).toBe(2);
});

// ── TC-BACKUP-02: Restore with no backup shows error ─────────────────────────

test('TC-BACKUP-02: restore with no existing backup shows "No backup found" error', async ({
  page,
}) => {
  await setup(page);
  // Intentionally do NOT create a backup

  await openSettings(page);

  await page.getByRole('button', { name: 'Restore from backup' }).click({ force: true });
  await page.getByRole('button', { name: 'Restore', exact: true }).click({ force: true });

  // The handler finds no backups and shows the noBackup toast
  await expect(page.getByText('No backup found.')).toBeVisible({ timeout: 6000 });
});

// ── TC-BACKUP-03: Export to file + restore from file ─────────────────────────

test('TC-BACKUP-03: export to file then restore from file round-trip restores both transactions', async ({
  page,
}) => {
  await setup(page);
  await seedFixture(page);

  await openSettings(page);

  // Trigger download
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to file' }).click({ force: true });
  const download = await downloadPromise;

  // Persist to a temp file
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'backup-'));
  const filePath = path.join(tmpDir, 'backup.json');
  await download.saveAs(filePath);

  // Confirm the export toast
  await expect(page.getByText('Backup exported.')).toBeVisible({ timeout: 6000 });

  // Wipe transactions
  await clearTxns(page);
  expect(await countTxns(page)).toBe(0);

  // Restore from the downloaded file via the hidden file input
  await page.locator('input[type="file"]').setInputFiles(filePath);
  // After the file is chosen the confirm dialog opens
  await page.getByRole('button', { name: 'Restore', exact: true }).click({ force: true });

  // Wait for reload
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  await expect(page).not.toHaveURL(/onboarding/);
  expect(await countTxns(page)).toBe(2);
});

// ── TC-BACKUP-04: Auto-backup schedule picker ─────────────────────────────────

test('TC-BACKUP-04: auto-backup schedule picker updates displayed interval', async ({ page }) => {
  await setup(page);
  await openSettings(page);

  // The schedule button shows the current interval label (defaults to "Off")
  const scheduleBtn = page.getByRole('button', { name: 'Auto-backup interval' });
  await expect(scheduleBtn).toBeVisible({ timeout: 6000 });

  await scheduleBtn.click({ force: true });

  // A bottom sheet opens with interval radio options
  await expect(page.getByRole('radiogroup', { name: 'Auto-backup interval' })).toBeVisible({
    timeout: 6000,
  });

  // Select the "24h" option — use evaluate to bypass overflow:hidden in the bottom sheet
  await page.getByRole('radio', { name: '24h' }).evaluate((el: HTMLElement) => el.click());

  // Sheet should close and the schedule button should reflect the new value
  await expect(page.getByRole('radiogroup', { name: 'Auto-backup interval' })).not.toBeVisible({
    timeout: 4000,
  });
  await expect(scheduleBtn).toContainText('24h');
});

// ── TC-BACKUP-05: Invalid file shows error toast ──────────────────────────────

test('TC-BACKUP-05: uploading a corrupted file shows an error toast', async ({ page }) => {
  await setup(page);
  await openSettings(page);

  // Write a clearly invalid JSON file to a temp location
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'bad-backup-'));
  const badFilePath = path.join(tmpDir, 'corrupted.json');
  writeFileSync(badFilePath, '{ this is not valid json !!!');

  // Upload it — this triggers the file-input onChange which sets pendingFile and
  // opens the confirm dialog
  await page.locator('input[type="file"]').setInputFiles(badFilePath);
  await page.getByRole('button', { name: 'Restore', exact: true }).click({ force: true });

  // importFromFile throws a SyntaxError from JSON.parse → catch shows err.message or fallback
  // We check that any error toast (role=status) appears rather than matching the raw error text
  await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 6000 });
});
