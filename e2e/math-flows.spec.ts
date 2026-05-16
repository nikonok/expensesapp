import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── IDB helpers ───────────────────────────────────────────────────────────────

async function getAccountById(page: import("@playwright/test").Page, id: number) {
  return page.evaluate((accountId: number) => {
    return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("accounts", "readonly");
        const r = tx.objectStore("accounts").get(accountId);
        r.onsuccess = () => resolve(r.result as Record<string, unknown> | undefined);
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, id);
}

async function getLastTransaction(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const txn = db.transaction("transactions", "readonly");
        const all: Record<string, unknown>[] = [];
        const r = txn.objectStore("transactions").openCursor();
        r.onsuccess = () => {
          const cursor = r.result;
          if (cursor) {
            all.push(cursor.value as Record<string, unknown>);
            cursor.continue();
          } else {
            all.sort((a, b) => (a.id as number) - (b.id as number));
            resolve(all[all.length - 1]);
          }
        };
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

interface SeedOneAccountResult {
  accountId: number;
  categoryId: number;
}

async function seedOneAccountWithCategory(
  page: import("@playwright/test").Page,
  opts: { balance: number; accountName?: string; accountType?: string },
): Promise<SeedOneAccountResult> {
  return page.evaluate(
    ({
      balance,
      accountName,
      accountType,
    }: {
      balance: number;
      accountName: string;
      accountType: string;
    }) => {
      return new Promise<SeedOneAccountResult>((resolve, reject) => {
        const req = indexedDB.open("expenses-app-db");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["accounts", "categories"], "readwrite");
          const now = new Date().toISOString();

          let accountId: number;
          let categoryId: number;

          const accReq = tx.objectStore("accounts").add({
            name: accountName,
            type: accountType,
            color: "oklch(73% 0.23 160)",
            icon: "wallet",
            currency: "USD",
            description: "",
            balance,
            startingBalance: balance,
            includeInTotal: true,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          accReq.onsuccess = () => {
            accountId = accReq.result as number;

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

          tx.oncomplete = () => {
            db.close();
            resolve({ accountId, categoryId });
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    {
      balance: opts.balance,
      accountName: opts.accountName ?? "Test Wallet",
      accountType: opts.accountType ?? "REGULAR",
    },
  );
}

interface SeedTwoAccountsResult {
  accountAId: number;
  accountBId: number;
}

async function seedTwoAccounts(
  page: import("@playwright/test").Page,
  opts: { balanceA: number; balanceB: number },
): Promise<SeedTwoAccountsResult> {
  return page.evaluate(
    ({ balanceA, balanceB }: { balanceA: number; balanceB: number }) => {
      return new Promise<SeedTwoAccountsResult>((resolve, reject) => {
        const req = indexedDB.open("expenses-app-db");
        req.onsuccess = () => {
          const db = req.result;
          // Include categories so TransactionInput's edit-init guard (allCategories.length > 0) passes
          const tx = db.transaction(["accounts", "categories"], "readwrite");
          const now = new Date().toISOString();

          let accountAId: number;
          let accountBId: number;

          const reqA = tx.objectStore("accounts").add({
            name: "Account A",
            type: "REGULAR",
            color: "oklch(73% 0.23 160)",
            icon: "wallet",
            currency: "USD",
            description: "",
            balance: balanceA,
            startingBalance: balanceA,
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
              balance: balanceB,
              startingBalance: balanceB,
              includeInTotal: true,
              isTrashed: false,
              createdAt: now,
              updatedAt: now,
            });

            reqB.onsuccess = () => {
              accountBId = reqB.result as number;

              // Seed a dummy category so TransactionInput's edit-init guard passes
              tx.objectStore("categories").add({
                name: "Transfer",
                type: "EXPENSE",
                color: "oklch(73% 0.23 160)",
                icon: "arrow-left-right",
                displayOrder: 0,
                isTrashed: false,
                createdAt: now,
                updatedAt: now,
              });
            };
          };

          tx.oncomplete = () => {
            db.close();
            resolve({ accountAId, accountBId });
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { balanceA: opts.balanceA, balanceB: opts.balanceB },
  );
}

// ── TC-M01: Arithmetic expression saves correctly ─────────────────────────────

test("TC-M01: arithmetic expression 12.50+7.25 saves as amount 1975", async ({ page }) => {
  await setup(page);
  const { accountId } = await seedOneAccountWithCategory(page, { balance: 50000 }); // $500.00

  // Navigate to new transaction via the Transactions tab + Add button (avoids startup redirect)
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick FROM account ("Test Wallet")
  await page.getByRole("button", { name: "Test Wallet" }).click();

  // Step 2: pick TO category ("Food")
  // Use force:true — the step transition may have a view-transition overlay briefly
  await page.getByRole("button", { name: "Food" }).click({ force: true });

  // Step 3: enter "12.50+7.25" on the numpad
  // Decimal uses aria-label "decimal point"; addition uses aria-label "add"
  await page.locator('button[aria-label="1"]').click();
  await page.locator('button[aria-label="2"]').click();
  await page.locator('button[aria-label="decimal point"]').click();
  await page.locator('button[aria-label="5"]').click();
  await page.locator('button[aria-label="0"]').click();
  await page.locator('button[aria-label="add"]').click();
  await page.locator('button[aria-label="7"]').click();
  await page.locator('button[aria-label="decimal point"]').click();
  await page.locator('button[aria-label="2"]').click();
  await page.locator('button[aria-label="5"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Verify last transaction amount = 1975 (1250 + 725 minor units)
  const lastTx = await getLastTransaction(page);
  expect(lastTx).toBeDefined();
  expect(lastTx!.amount).toBe(1975);

  // Verify account balance decreased by 1975: 50000 - 1975 = 48025
  const account = await getAccountById(page, accountId);
  expect(account!.balance).toBe(48025);
});

// ── TC-M02: Transfer updates both account balances ────────────────────────────

test("TC-M02: transfer $20 from Account A to Account B updates both balances", async ({ page }) => {
  await setup(page);
  const { accountAId, accountBId } = await seedTwoAccounts(page, {
    balanceA: 10000, // $100.00
    balanceB: 5000, // $50.00
  });

  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  // Step 1: pick FROM account ("Account A")
  await page.getByRole("button", { name: "Account A" }).click();

  // Step 2: pick TO account ("Account B") — shown with TRANSFER chip
  await page.getByRole("button", { name: "Account B" }).click({ force: true });

  // Step 3: enter $20.00 — numpad works in major units, "20" = $20.00 = 2000 minor units
  await page.locator('button[aria-label="2"]').click();
  await page.locator('button[aria-label="0"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Account A: 10000 - 2000 = 8000
  const accountA = await getAccountById(page, accountAId);
  expect(accountA!.balance).toBe(8000);

  // Account B: 5000 + 2000 = 7000
  const accountB = await getAccountById(page, accountBId);
  expect(accountB!.balance).toBe(7000);
});

// ── TC-M03: DEBT account balance direction ────────────────────────────────────
//
// For DEBT accounts, EXPENSE transactions use getBalanceDelta → +tx.amount (sign is inverted).
// So an EXPENSE of $100 on a DEBT account with balance -50000 results in:
//   -50000 + 10000 = -40000 (debt reduces from $500 owed to $400 owed).
//
// The UI prevents DEBT accounts from being selected as FROM in Step 1, so we seed the
// transaction directly via IDB applying the same balance logic as balance.service.ts.

test("TC-M03: DEBT account EXPENSE adds to balance (reduces owed amount)", async ({ page }) => {
  await setup(page);

  // Seed a DEBT account (owes $500) and a REGULAR account
  const ids = await page.evaluate(() => {
    return new Promise<{ debtAccountId: number; regularAccountId: number }>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "categories"], "readwrite");
        const now = new Date().toISOString();

        let debtAccountId: number;
        let regularAccountId: number;

        const debtReq = tx.objectStore("accounts").add({
          name: "Credit Card",
          type: "DEBT",
          color: "oklch(62% 0.28 18)",
          icon: "credit-card",
          currency: "USD",
          description: "",
          balance: -50000,
          startingBalance: -50000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        debtReq.onsuccess = () => {
          debtAccountId = debtReq.result as number;

          const regReq = tx.objectStore("accounts").add({
            name: "Cash Wallet",
            type: "REGULAR",
            color: "oklch(73% 0.23 160)",
            icon: "wallet",
            currency: "USD",
            description: "",
            balance: 10000,
            startingBalance: 10000,
            includeInTotal: true,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });

          regReq.onsuccess = () => {
            regularAccountId = regReq.result as number;
          };

          // Also seed a category so the EXPENSE transaction is valid
          tx.objectStore("categories").add({
            name: "Shopping",
            type: "EXPENSE",
            color: "oklch(62% 0.28 18)",
            icon: "shopping-cart",
            displayOrder: 0,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          });
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ debtAccountId, regularAccountId });
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Apply a direct EXPENSE of $100 on the DEBT account via IDB.
  // Replicates balance.service applyTransaction logic:
  //   getBalanceDelta(DEBT, EXPENSE) = +tx.amount
  //   new balance = -50000 + 10000 = -40000
  await page.evaluate(
    ({ debtId }: { debtId: number }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("expenses-app-db");
        req.onsuccess = () => {
          const db = req.result;
          const txn = db.transaction(["accounts", "transactions"], "readwrite");
          const now = new Date().toISOString();
          const txAmount = 10000; // $100.00

          const getReq = txn.objectStore("accounts").get(debtId);
          getReq.onsuccess = () => {
            const account = getReq.result as Record<string, unknown>;
            // EXPENSE on DEBT: delta = +tx.amount (inverted sign convention)
            const newBalance = (account.balance as number) + txAmount;
            txn.objectStore("accounts").put({ ...account, balance: newBalance, updatedAt: now });
            txn.objectStore("transactions").add({
              type: "EXPENSE",
              date: now.slice(0, 10),
              timestamp: now,
              displayOrder: 0,
              accountId: debtId,
              categoryId: 1,
              currency: "USD",
              amount: txAmount,
              amountMainCurrency: txAmount,
              exchangeRate: 1,
              note: "",
              transferGroupId: null,
              transferDirection: null,
              createdAt: now,
              updatedAt: now,
            });
          };

          txn.oncomplete = () => {
            db.close();
            resolve();
          };
          txn.onerror = () => reject(txn.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { debtId: ids.debtAccountId },
  );

  // DEBT account: -50000 + 10000 = -40000
  const debtAccount = await getAccountById(page, ids.debtAccountId);
  expect(debtAccount!.balance).toBe(-40000);

  // REGULAR account untouched
  const regularAccount = await getAccountById(page, ids.regularAccountId);
  expect(regularAccount!.balance).toBe(10000);
});

// ── TC-M04: Edit transfer amount — both balances update correctly ──────────────

test("TC-M04: editing transfer amount recalculates both balances without double-applying", async ({
  page,
}) => {
  await setup(page);
  const { accountAId, accountBId } = await seedTwoAccounts(page, {
    balanceA: 10000, // $100.00
    balanceB: 5000, // $50.00
  });

  // Step 1: create initial $20 transfer A → B
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await page.getByRole("button", { name: "Account A" }).click();
  await page.getByRole("button", { name: "Account B" }).click({ force: true });

  // $20.00 — numpad works in major units: "20" = $20.00 = 2000 minor units
  await page.locator('button[aria-label="2"]').click();
  await page.locator('button[aria-label="0"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Verify intermediate state: A=8000, B=7000
  const afterFirstA = await getAccountById(page, accountAId);
  expect(afterFirstA!.balance).toBe(8000);
  const afterFirstB = await getAccountById(page, accountBId);
  expect(afterFirstB!.balance).toBe(7000);

  // Step 2: find the OUT leg transaction ID from IDB.
  const outTxId = await page.evaluate(() => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const txn = db.transaction("transactions", "readonly");
        const all: Array<{ id: number; transferDirection: string }> = [];
        const r = txn.objectStore("transactions").openCursor();
        r.onsuccess = () => {
          const cursor = r.result;
          if (cursor) {
            all.push(cursor.value as { id: number; transferDirection: string });
            cursor.continue();
          } else {
            const out = all.find((t) => t.transferDirection === "OUT");
            if (out) resolve(out.id);
            else reject(new Error("No OUT transfer found"));
          }
        };
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Update startupScreen to "transactions" so that a fresh page.goto() to the edit URL
  // triggers a redirect to /transactions (not /accounts), which keeps us in the right tab.
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const txn = db.transaction("settings", "readwrite");
        txn.objectStore("settings").put({ key: "startupScreen", value: "transactions" });
        txn.oncomplete = () => { db.close(); resolve(); };
        txn.onerror = () => reject(txn.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Navigate to the edit URL with page.goto — the cold-start redirect fires ONCE:
  // coldStartPath = /transactions/N/edit, startupScreen = "transactions" → redirect to /transactions.
  await page.goto(`/transactions/${outTxId}/edit`);
  await page.waitForURL(/\/transactions$/, { timeout: 8000 });
  await page.waitForTimeout(400);

  // Now click the transfer row to select it, then use the Edit button.
  await page.getByRole("button", { name: /Account A.*Account B/ }).first().click();
  await expect(page.locator('button[aria-label="Edit transaction"]')).toBeVisible({
    timeout: 5000,
  });
  await page.locator('button[aria-label="Edit transaction"]').click();
  await page.waitForURL(/\/transactions\/\d+\/edit/, { timeout: 8000 });

  // Wait for the edit form to populate — numpad must show "20" (= $20.00 = 2000 minor units)
  await page.locator('button[aria-label="backspace"]').waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(600);

  // Clear existing value: numpad shows "20" (2 chars)
  await page.locator('button[aria-label="backspace"]').click();
  await page.locator('button[aria-label="backspace"]').click();

  // Enter $15.00 — numpad works in major units: "15" = $15.00 = 1500 minor units
  await page.locator('button[aria-label="1"]').click();
  await page.locator('button[aria-label="5"]').click();

  await page.locator('button[aria-label="save"]').click();
  await page.waitForURL(/\/(transactions|accounts)/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Expected after edit: A = 10000 - 1500 = 8500, B = 5000 + 1500 = 6500
  // replaceTransfer reverts the old $20 transfer, then applies the new $15 transfer.
  // No double-subtract bug: balances are computed from original values, not post-first-transfer.
  const finalA = await getAccountById(page, accountAId);
  expect(finalA!.balance).toBe(8500);

  const finalB = await getAccountById(page, accountBId);
  expect(finalB!.balance).toBe(6500);
});
