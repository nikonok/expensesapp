// Covers: TotalWealth header sums multi-currency account balances using cached exchange rates
import { test, expect } from "@playwright/test";
import { setup } from "./helpers";

// ── IDB helpers ───────────────────────────────────────────────────────────────

async function seedMultiCurrencyFixtures(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["accounts", "settings", "exchangeRates"], "readwrite");
        const now = new Date().toISOString();
        const today = now.slice(0, 10);

        // Seed main currency setting = USD
        tx.objectStore("settings").put({ key: "mainCurrency", value: "USD" });

        // Seed USD account: balance = 10000 minor units = $100.00
        tx.objectStore("accounts").add({
          name: "USD Account",
          type: "REGULAR",
          color: "oklch(73% 0.23 160)",
          icon: "wallet",
          currency: "USD",
          description: "",
          balance: 10000, // $100.00
          startingBalance: 10000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        // Seed EUR account: balance = 10000 minor units = €100.00
        tx.objectStore("accounts").add({
          name: "EUR Account",
          type: "REGULAR",
          color: "oklch(62% 0.28 18)",
          icon: "credit-card",
          currency: "EUR",
          description: "",
          balance: 10000, // €100.00
          startingBalance: 10000,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });

        // Seed exchange rate: base = USD (main currency)
        // deriveRate(from="EUR", to="USD", base="USD"):
        //   since to === base: rate = 1 / rates["EUR"]
        //   We want EUR→USD = 1.10, so rates["EUR"] = 1/1.10 ≈ 0.909090...
        // This means 1 USD = 0.909090... EUR, i.e., 1 EUR = 1.10 USD.
        tx.objectStore("exchangeRates").add({
          baseCurrency: "USD",
          date: today,
          rates: {
            USD: 1,
            EUR: 1 / 1.1, // ≈ 0.9090909...  → deriveRate(EUR, USD) = 1/(1/1.1) = 1.1
          },
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

// ── TC-MC01: TotalWealth header shows ~$210 for $100 USD + €100 EUR @ 1.10 ────

test("TC-MC01: TotalWealth displays multi-currency sum using exchange rates", async ({ page }) => {
  await setup(page);
  await seedMultiCurrencyFixtures(page);

  // Reload so Dexie and the settings store pick up the newly seeded data
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForURL(/\/accounts/, { timeout: 8000 });
  await page.waitForTimeout(800); // Allow async exchange rate computation to settle

  // The AccountList page shows a "Total Balance" button with a role="status" span
  // inside it that displays the net worth. The button itself has aria-label "View total wealth breakdown".
  const totalBalanceStatus = page
    .getByRole("button", { name: "View total wealth breakdown" })
    .locator('[role="status"]');
  await expect(totalBalanceStatus).toBeVisible({ timeout: 10000 });

  // Expected: $100 (USD) + €100 × 1.10 (USD/EUR) = $100 + $110 = $210
  // formatNetWorth(21000, "USD") via Intl.NumberFormat → "$210.00"
  const displayText = await totalBalanceStatus.textContent();
  expect(displayText).not.toBeNull();
  expect(displayText).toContain("210");
});
