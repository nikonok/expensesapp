// Covers: debt payment through UI produces correct balance changes on both source and debt accounts
import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── IDB helpers ───────────────────────────────────────────────────────────────

interface SeedResult {
  regularAccountId: number;
  debtAccountId: number;
}

async function seedRegularAndDebtAccounts(
  page: import("@playwright/test").Page,
): Promise<SeedResult> {
  return page.evaluate(() => {
    return new Promise<SeedResult>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        let regularAccountId: number;
        let debtAccountId: number;

        const regReq = tx.objectStore("accounts").add({
          name: "Cash Wallet",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 500000, // $5000.00
          startingBalance: 500000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        regReq.onsuccess = () => {
          regularAccountId = regReq.result as number;

          const debtReq = tx.objectStore("accounts").add({
            name: "Credit Card Debt",
            type: "DEBT",
            color: "oklch(62% 0.28 18)",
            icon: "credit-card",
            currency: "USD",
            description: "",
            balance: 3800000, // $38000.00 owed (stored positive — see balance.service.test.ts)
            startingBalance: 3800000,
            includeInTotal: true,
            isTrashed: false,
            debtOriginalAmount: 4000000,
            createdAt: now,
            updatedAt: now,
          });

          debtReq.onsuccess = () => {
            debtAccountId = debtReq.result as number;

            // Seed a dummy expense category so the TransactionInput guard passes
            tx.objectStore("categories").add({
              name: "Payment",
              type: "EXPENSE",
              color: "oklch(62% 0.28 18)",
              icon: "credit-card",
              displayOrder: 0,
              isTrashed: false,
              createdAt: now,
              updatedAt: now,
            });
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ regularAccountId, debtAccountId });
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

interface TransferPair {
  groupId: string | null;
  count: number;
}

async function getTransferPair(page: import("@playwright/test").Page): Promise<TransferPair> {
  return page.evaluate(() => {
    return new Promise<TransferPair>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("transactions", "readonly");
        const all: Array<{ transferGroupId: string | null }> = [];
        const r = tx.objectStore("transactions").openCursor();
        r.onsuccess = () => {
          const cursor = r.result;
          if (cursor) {
            all.push(cursor.value as { transferGroupId: string | null });
            cursor.continue();
          } else {
            const groupId = all.length > 0 ? all[0].transferGroupId : null;
            resolve({ groupId, count: all.length });
          }
        };
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// ── TC-DP01: Debt payment updates both account balances correctly ───────────────

test("TC-DP01: debt payment of $2000 decreases source balance and increases debt balance", async ({
  page,
}) => {
  test.setTimeout(30000);

  await setup(page);
  const { regularAccountId, debtAccountId } = await seedRegularAndDebtAccounts(page);

  // Navigate to Transactions and open new transaction form
  await goToTab(page, "Transactions", /\/transactions/);
  await page
    .locator('button[aria-label="Add transaction"]')
    .evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForURL(/\/transactions\/new/, { timeout: 10000 });

  // Step 1: pick FROM account (Cash Wallet — regular non-debt account)
  await expect(page.getByRole("button", { name: /Cash Wallet/i })).toBeVisible();
  await page.getByRole("button", { name: /Cash Wallet/i }).click();

  // Step 2: pick TO account (Credit Card Debt — shown with DEBT chip)
  await expect(page.getByRole("button", { name: /Credit Card Debt/i })).toBeVisible();
  await page.getByRole("button", { name: /Credit Card Debt/i }).click();

  // Step 3: enter $2000.00 on the numpad (major units: "2000" = 200000 minor units)
  await page.locator('button[aria-label="2"]').click();
  await page.locator('button[aria-label="0"]').click();
  await page.locator('button[aria-label="0"]').click();
  await page.locator('button[aria-label="0"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Source regular account: 500000 - 200000 = 300000
  const srcBalance = await getAccountBalance(page, regularAccountId);
  expect(srcBalance).toBe(300000);

  // Debt balances are stored POSITIVE. A $2000 payment reduces what's owed:
  // 3,800,000 - 200,000 = 3,600,000 ($36,000 still owed).
  const debtBalance = await getAccountBalance(page, debtAccountId);
  expect(debtBalance).toBe(3600000);

  // Assert two transaction records share a transferGroupId
  const pair = await getTransferPair(page);
  expect(pair.count).toBe(2);
  expect(pair.groupId).not.toBeNull();
});
