import { test, expect, type Page } from "@playwright/test";

async function clearDB(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("expenses-app-db");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });
  await page.reload();
}

async function completeOnboarding(page: Page) {
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.getByRole("button", { name: "Next" }).click(); // step 1: currency
  await page.getByRole("button", { name: "Next" }).click(); // step 2: account
  await page.getByRole("button", { name: "Next" }).click(); // step 3: categories → triggers handleFinish
}

async function getStore<T = Record<string, unknown>>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate(async (store) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(store, "readonly");
        const all = tx.objectStore(store).getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => reject(all.error);
      };
    });
  }, storeName) as Promise<T[]>;
}

test("onboarding complete popup: appears after finishing onboarding", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);

  await page.waitForURL(/\/transactions/);

  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  await expect(popup.getByText("You're all set")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Cancel & start over" })).toBeVisible();
});

test("onboarding complete popup: appears after skipping onboarding", async ({ page }) => {
  await clearDB(page);
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: /skip/i }).first().click();

  await page.waitForURL(/\/transactions/);

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("You're all set")).toBeVisible();
});

test("onboarding complete popup: cancel resets data and returns to onboarding", async ({
  page,
}) => {
  await clearDB(page);
  await completeOnboarding(page);

  await page.waitForURL(/\/transactions/);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByRole("button", { name: "Cancel & start over" }).click();

  await page.waitForURL(/\/onboarding/);
  await expect(page.getByRole("dialog")).not.toBeVisible();

  // Verify DB was cleared — no accounts should exist
  const accounts = await getStore(page, "accounts");
  expect(accounts).toHaveLength(0);
});

test("popup remains open after 7 seconds with no auto-close", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);
  await page.waitForURL(/\/transactions/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(7000);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("dismisses on X button click — data preserved", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);
  await page.waitForURL(/\/transactions/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  // Data preserved (full-save path created Cash account)
  const accounts = await getStore(page, "accounts");
  expect(accounts.length).toBeGreaterThanOrEqual(1);
});

test("dismisses on Escape key — data preserved", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);
  await page.waitForURL(/\/transactions/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const accounts = await getStore(page, "accounts");
  expect(accounts.length).toBeGreaterThanOrEqual(1);
});

test("dismisses on backdrop click — data preserved", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);
  await page.waitForURL(/\/transactions/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Click near the corner of the backdrop, away from the card
  await dialog.click({ position: { x: 5, y: 5 } });
  await expect(dialog).not.toBeVisible();
  const accounts = await getStore(page, "accounts");
  expect(accounts.length).toBeGreaterThanOrEqual(1);
});

test("skip writes only hasCompletedOnboarding flag — no other DB rows", async ({ page }) => {
  await clearDB(page);
  await page.goto("/onboarding");
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "Skip" }).click();
  await page.waitForURL(/\/transactions/);
  // Dismiss popup
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();

  const accounts = await getStore(page, "accounts");
  expect(accounts).toHaveLength(0);
  const categories = await getStore(page, "categories");
  expect(categories).toHaveLength(0);
  const settings = await getStore<{ key: string; value: unknown }>(page, "settings");
  expect(settings).toHaveLength(1);
  expect(settings[0].key).toBe("hasCompletedOnboarding");
  expect(settings[0].value).toBe(true);
});
