import { test, expect, Page } from "@playwright/test";
import { setup } from "./helpers";

async function clickAndWaitForResult(page: Page, buttonText: string, timeoutMs = 15000) {
  const t0 = Date.now();
  await page.click(`button:has-text("${buttonText}")`);

  // Wait until no button says "Running…" (i.e., all demos are idle/done/error).
  // We cannot look for the specific button by its original label because the text
  // changes to "Running…" while running. Instead, wait until no button has
  // "Running" in its text at all.
  await page.waitForFunction(
    () => {
      const btns = Array.from(document.querySelectorAll("button"));
      return !btns.some((b) => b.textContent?.includes("Running"));
    },
    undefined,
    { timeout: timeoutMs },
  );

  const elapsed = Date.now() - t0;
  return elapsed;
}

test("all 4 demos complete without errors", async ({ page }) => {
  // setup() marks onboarding complete in IndexedDB so the app doesn't redirect.
  await setup(page);
  await page.goto("http://localhost:5173/dev/crypto-demo");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector('button:has-text("Run Demo 1")', { timeout: 10000 });

  // Helper to check for error messages after each demo
  async function getErrors() {
    return page.$$eval("div", (divs) =>
      divs
        .filter((d) => {
          const text = d.textContent?.trim() ?? "";
          return (
            text.startsWith("Error:") && d.children.length === 0 // leaf node
          );
        })
        .map((d) => d.textContent?.trim()),
    );
  }

  console.log("\n--- Demo 1: Record encrypt/decrypt ---");
  const ms1 = await clickAndWaitForResult(page, "Run Demo 1");
  const errors1 = await getErrors();
  console.log(`  Elapsed: ${ms1}ms`);
  if (errors1.length) console.log(`  ERRORS: ${errors1.join(", ")}`);

  console.log("--- Demo 2: Device key wrap/unwrap ---");
  const ms2 = await clickAndWaitForResult(page, "Run Demo 2");
  const errors2 = await getErrors();
  console.log(`  Elapsed: ${ms2}ms`);
  if (errors2.length) console.log(`  ERRORS: ${errors2.join(", ")}`);

  console.log("--- Demo 3: Argon2id ---");
  const ms3 = await clickAndWaitForResult(page, "Run Demo 3", 30000);
  const errors3 = await getErrors();
  console.log(`  Elapsed: ${ms3}ms`);
  if (errors3.length) console.log(`  ERRORS: ${errors3.join(", ")}`);

  console.log("--- Demo 4: AAD vectors ---");
  const ms4 = await clickAndWaitForResult(page, "Run Demo 4");
  const errors4 = await getErrors();
  console.log(`  Elapsed: ${ms4}ms`);
  if (errors4.length) console.log(`  ERRORS: ${errors4.join(", ")}`);

  // Collect all result chips
  const chips = await page.$$eval("span", (spans) =>
    spans
      .filter((s) => s.textContent?.includes("✓ PASS") || s.textContent?.includes("✗ FAIL"))
      .map((s) => s.textContent?.trim()),
  );

  console.log("\nResult chips:", chips);

  // Check passed count from Demo 4
  const passedText = await page.textContent("text=passed").catch(() => null);
  console.log("Demo 4 passed text:", passedText);

  const totalErrors = [...errors1, ...errors2, ...errors3, ...errors4];

  expect(totalErrors, `Errors found: ${totalErrors.join("; ")}`).toHaveLength(0);
  expect(chips.filter((c) => c?.includes("✓ PASS"))).toHaveLength(4);
  expect(chips.filter((c) => c?.includes("✗ FAIL"))).toHaveLength(0);
});
