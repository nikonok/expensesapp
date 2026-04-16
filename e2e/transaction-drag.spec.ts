import { test, expect } from '@playwright/test';
import { setup, goToTab } from './helpers';

// ── Seed helper ────────────────────────────────────────────────────────────────

interface DragFixtureIds {
  accountId: number;
  categoryId: number;
}

/**
 * Seed one account and one expense category for drag tests.
 */
async function seedDragFixtures(page: import('@playwright/test').Page): Promise<DragFixtureIds> {
  return page.evaluate(() => {
    return new Promise<{ accountId: number; categoryId: number }>((resolve, reject) => {
      const req = indexedDB.open('expenses-app-db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['accounts', 'categories'], 'readwrite');
        const now = new Date().toISOString();

        const accReq = tx.objectStore('accounts').add({
          name: 'Drag Wallet',
          type: 'REGULAR',
          color: 'oklch(73% 0.23 160)',
          icon: 'wallet',
          currency: 'USD',
          description: '',
          balance: 50000,
          startingBalance: 50000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        let accountId: number;
        let categoryId: number;

        accReq.onsuccess = () => {
          accountId = accReq.result as number;

          const catReq = tx.objectStore('categories').add({
            name: 'Drag Food',
            type: 'EXPENSE',
            color: 'oklch(62% 0.28 18)',
            icon: 'utensils',
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
 * Seed three transactions for drag tests:
 *  - DRAG-A: today, displayOrder=0
 *  - DRAG-B: today, displayOrder=10
 *  - DRAG-C: yesterday, displayOrder=0
 */
async function seedDragTransactions(
  page: import('@playwright/test').Page,
  accountId: number,
  categoryId: number,
): Promise<void> {
  await page.evaluate(
    ({ accountId, categoryId }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('expenses-app-db');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('transactions', 'readwrite');
          const store = tx.objectStore('transactions');
          const now = new Date().toISOString();

          // Compute today and yesterday as "YYYY-MM-DD" local dates
          const todayDate = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const toDateStr = (d: Date) =>
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const today = toDateStr(todayDate);
          const yesterdayDate = new Date(todayDate);
          yesterdayDate.setDate(yesterdayDate.getDate() - 1);
          const yesterday = toDateStr(yesterdayDate);

          store.add({
            type: 'EXPENSE',
            date: today,
            timestamp: now,
            displayOrder: 0,
            accountId,
            categoryId,
            currency: 'USD',
            amount: 5000,
            amountMainCurrency: 5000,
            exchangeRate: 1,
            note: 'DRAG-A',
            isTrashed: false,
            transferGroupId: null,
            transferDirection: null,
            createdAt: now,
            updatedAt: now,
          });

          store.add({
            type: 'EXPENSE',
            date: today,
            timestamp: now,
            displayOrder: 10,
            accountId,
            categoryId,
            currency: 'USD',
            amount: 3000,
            amountMainCurrency: 3000,
            exchangeRate: 1,
            note: 'DRAG-B',
            isTrashed: false,
            transferGroupId: null,
            transferDirection: null,
            createdAt: now,
            updatedAt: now,
          });

          store.add({
            type: 'EXPENSE',
            date: yesterday,
            timestamp: now,
            displayOrder: 0,
            accountId,
            categoryId,
            currency: 'USD',
            amount: 2000,
            amountMainCurrency: 2000,
            exchangeRate: 1,
            note: 'DRAG-C',
            isTrashed: false,
            transferGroupId: null,
            transferDirection: null,
            createdAt: now,
            updatedAt: now,
          });

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { accountId, categoryId },
  );
}

/**
 * Read all DRAG-* transactions from IndexedDB.
 * Returns an object keyed by the suffix (A, B, C) with { date, displayOrder }.
 */
async function readDragTxs(
  page: import('@playwright/test').Page,
): Promise<Record<string, { date: string; displayOrder: number }>> {
  return page.evaluate(() =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('expenses-app-db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('transactions', 'readonly');
        const store = tx.objectStore('transactions');
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const rows = (getAllReq.result as Array<{ note: string; date: string; displayOrder: number }>).filter(
            (r) => r.note?.startsWith('DRAG-'),
          );
          const result: Record<string, { date: string; displayOrder: number }> = {};
          for (const r of rows) {
            result[r.note.slice(5)] = { date: r.date, displayOrder: r.displayOrder };
          }
          db.close();
          resolve(result);
        };
        getAllReq.onerror = () => reject(getAllReq.error);
      };
      req.onerror = () => reject(req.error);
    }),
  );
}

// ── Helper: perform a drag using low-level mouse API ──────────────────────────

/**
 * Drag an element's bounding-box centre to a target Y coordinate.
 * Moves 10px downward first to overcome the PointerSensor distance:8 constraint.
 */
async function dragTo(
  page: import('@playwright/test').Page,
  sourceHandle: import('@playwright/test').Locator,
  targetHandle: import('@playwright/test').Locator,
) {
  const sourceBB = await sourceHandle.boundingBox();
  const targetBB = await targetHandle.boundingBox();
  if (!sourceBB || !targetBB) throw new Error('Could not get bounding boxes for drag handles');

  const startX = sourceBB.x + sourceBB.width / 2;
  const startY = sourceBB.y + sourceBB.height / 2;
  const endX = targetBB.x + targetBB.width / 2;
  const endY = targetBB.y + targetBB.height / 2 + 5; // land just below centre of target

  // Move to start position
  await page.mouse.move(startX, startY);
  // Press
  await page.mouse.down();
  // Small nudge to exceed the distance:8 activation constraint
  await page.mouse.move(startX, startY + 10, { steps: 3 });
  // Move to destination
  await page.mouse.move(endX, endY, { steps: 20 });
  // Release
  await page.mouse.up();
}

// ── TC-DRAG-01: Same-day reorder ───────────────────────────────────────────────

test('TC-DRAG-01: same-day drag reorders displayOrder in IndexedDB', async ({ page }) => {
  await setup(page);
  const { accountId, categoryId } = await seedDragFixtures(page);
  await seedDragTransactions(page, accountId, categoryId);

  await goToTab(page, 'Transactions', /\/transactions/);

  // Verify transaction notes are visible (proves list rendered)
  await expect(page.getByText('DRAG-A')).toBeVisible();
  await expect(page.getByText('DRAG-B')).toBeVisible();

  // Drag handles: DRAG-A is first (index 0), DRAG-B is second (index 1) within today's group
  const handles = page.locator('[data-drag-handle="true"]');
  const handleA = handles.nth(0); // DRAG-A (displayOrder=0, rendered first)
  const handleB = handles.nth(1); // DRAG-B (displayOrder=10, rendered second)

  // Drag A below B
  await dragTo(page, handleA, handleB);

  // Wait for Dexie live-query to propagate and React to re-render
  await page.waitForTimeout(500);

  // Verify in IndexedDB: DRAG-B.displayOrder should now be less than DRAG-A.displayOrder
  const rows = await readDragTxs(page);
  expect(rows['B'].displayOrder).toBeLessThan(rows['A'].displayOrder);
});

// ── TC-DRAG-02: Cross-day drag changes date ────────────────────────────────────

test('TC-DRAG-02: cross-day drag moves transaction to target date in IndexedDB', async ({ page }) => {
  await setup(page);
  const { accountId, categoryId } = await seedDragFixtures(page);
  await seedDragTransactions(page, accountId, categoryId);

  await goToTab(page, 'Transactions', /\/transactions/);

  // Verify all three are visible
  await expect(page.getByText('DRAG-A')).toBeVisible();
  await expect(page.getByText('DRAG-C')).toBeVisible();

  // Record today's date string before the drag
  const todayStr = await page.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  // The layout order is: today group (DRAG-A at index 0, DRAG-B at index 1), then yesterday group (DRAG-C at index 2)
  const handles = page.locator('[data-drag-handle="true"]');
  const handleC = handles.nth(2); // DRAG-C, yesterday
  const handleA = handles.nth(0); // DRAG-A, today — drag C to this position

  // Drag C (yesterday) up to A's position (today)
  await dragTo(page, handleC, handleA);

  // Wait for DB write and React re-render
  await page.waitForTimeout(500);

  // Verify that DRAG-C.date now equals today
  const rows = await readDragTxs(page);
  expect(rows['C'].date).toBe(todayStr);
});
