import { test, expect } from "@playwright/test";

async function clearDB(page: import("@playwright/test").Page) {
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

async function completeOnboarding(page: import("@playwright/test").Page) {
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.getByRole("button", { name: "Next" }).click(); // step 1: currency
  await page.getByRole("button", { name: "Next" }).click(); // step 2: account
  await page.getByRole("button", { name: "Next" }).click(); // step 3: categories → triggers handleFinish
}

test("onboarding complete popup: appears after finishing onboarding", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);

  await page.waitForURL(/\/transactions/);

  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  await expect(popup.getByText("You're all set")).toBeVisible();
  await expect(popup.getByText(/Closing in/)).toBeVisible();
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
  const accounts = await page.evaluate(async () => {
    const request = indexedDB.open("expenses-app-db");
    return new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("accounts", "readonly");
        const req = tx.objectStore("accounts").getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  expect(accounts).toHaveLength(0);
});

test("onboarding complete popup: auto-dismisses after 6 seconds", async ({ page }) => {
  await clearDB(page);
  await completeOnboarding(page);

  await page.waitForURL(/\/transactions/);
  await expect(page.getByRole("dialog")).toBeVisible();

  // Wait for the 6-second countdown to expire
  await page.waitForTimeout(7000);

  await expect(page.getByRole("dialog")).not.toBeVisible();
  // User stays on the main app
  await expect(page).toHaveURL(/\/transactions/);
});
