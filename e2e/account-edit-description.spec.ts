import { test, expect } from "@playwright/test";
import { setup } from "./helpers";

test("TC-034 (P1): account description persists after edit", async ({ page }) => {
  await setup(page);

  await page.locator('button[aria-label="Add account"]').click({ force: true });
  await expect(page.locator("input#acc-name")).toBeVisible();

  await page.fill("input#acc-name", "My Account");
  await page.locator("textarea#acc-desc").fill("initial note");

  await page
    .getByRole("button", { name: "Create Account" })
    .evaluate((el) => (el as HTMLButtonElement).click());

  await expect(page.getByText("My Account")).toBeVisible();

  await page.locator("button", { hasText: "My Account" }).click();

  await page
    .getByRole("button", { name: "Edit" })
    .evaluate((el) => (el as HTMLButtonElement).click());

  await expect(page.locator("textarea#acc-desc")).toBeVisible();
  await expect(page.locator("textarea#acc-desc")).toHaveValue("initial note");

  await page.locator("textarea#acc-desc").fill("updated note");

  await page
    .getByRole("button", { name: "Save Changes" })
    .evaluate((el) => (el as HTMLButtonElement).click());

  await expect(page.locator("textarea#acc-desc")).not.toBeVisible();

  await page.locator("button", { hasText: "My Account" }).click();

  await page
    .getByRole("button", { name: "Edit" })
    .evaluate((el) => (el as HTMLButtonElement).click());

  await expect(page.locator("textarea#acc-desc")).toHaveValue("updated note");
});
