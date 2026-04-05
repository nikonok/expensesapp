import type { Page } from '@playwright/test';

/**
 * Mark onboarding as complete via IndexedDB, then navigate to /accounts.
 * Faster and more reliable than clicking through the onboarding UI.
 */
export async function setup(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Give Dexie time to open and initialize the DB
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('expenses-app-db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ key: 'hasCompletedOnboarding', value: true });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await page.goto('/accounts');
  await page.waitForURL(/\/accounts/);
}

/** Click a bottom-nav tab. force:true survives view-transition DOM swaps. */
export async function goToTab(page: Page, label: string, url: RegExp) {
  await page.locator(`button[aria-label="${label}"]`).click({ force: true });
  await page.waitForURL(url, { timeout: 8000 });
}
