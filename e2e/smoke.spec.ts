import { test, expect } from "@playwright/test";
import { setup, goToTab } from "./helpers";

// ── Bottom nav ────────────────────────────────────────────────────────────────

test("bottom nav has all 5 tabs", async ({ page }) => {
  await setup(page);
  for (const label of ["Accounts", "Categories", "Transactions", "Budget", "Overview"]) {
    await expect(page.locator(`button[aria-label="${label}"]`)).toBeVisible();
  }
});

test("active tab reflects current route", async ({ page }) => {
  await setup(page);
  await expect(page.locator('button[aria-current="page"]')).toHaveAttribute(
    "aria-label",
    "Accounts",
  );

  await goToTab(page, "Transactions", /\/transactions/);
  await expect(page.locator('button[aria-current="page"]')).toHaveAttribute(
    "aria-label",
    "Transactions",
  );
});

// ── Accounts tab ──────────────────────────────────────────────────────────────

test("accounts tab — empty state", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
  await expect(page.getByText("Create your first account")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Account", exact: true })).toBeVisible();
});

// ── Categories tab ────────────────────────────────────────────────────────────

test("categories tab — empty state", async ({ page }) => {
  await setup(page);
  await goToTab(page, "Categories", /\/categories/);
  await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No categories yet" })).toBeVisible();
});

// ── Transactions tab ──────────────────────────────────────────────────────────

test("transactions tab — empty state", async ({ page }) => {
  await setup(page);
  await goToTab(page, "Transactions", /\/transactions/);
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No transactions" })).toBeVisible();
  await expect(page.getByText("Tap + to add your first transaction")).toBeVisible();
  await expect(page.getByText(/April 2026/)).toBeVisible();
  await expect(page.locator('button[aria-label="Add transaction"]')).toBeVisible();
});

// ── Budget tab ────────────────────────────────────────────────────────────────

test("budget tab — empty state", async ({ page }) => {
  await setup(page);
  await goToTab(page, "Budget", /\/budget/);
  await expect(page.getByRole("heading", { name: "Budget", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No budget data" })).toBeVisible();
  await expect(page.getByText(/April 2026/)).toBeVisible();
});

// ── Overview tab ──────────────────────────────────────────────────────────────

test("overview tab — empty state", async ({ page }) => {
  await setup(page);
  await goToTab(page, "Overview", /\/overview/);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No data for this period" })).toBeVisible();
  await expect(page.getByText("Add some transactions to see your overview")).toBeVisible();
});

// ── New transaction form ──────────────────────────────────────────────────────

test("new transaction form — elements present", async ({ page }) => {
  await setup(page);
  await goToTab(page, "Transactions", /\/transactions/);
  await page.locator('button[aria-label="Add transaction"]').click();
  await page.waitForURL(/\/transactions\/new/, { timeout: 8000 });

  await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible();
  await expect(page.locator('button[aria-label="Back"]')).toBeVisible();
  // Step-based form (no tabs) — verify the form shell is open and interactive
  await expect(page.locator('button[aria-label="Back"]')).toBeEnabled();
});

// ── Settings ──────────────────────────────────────────────────────────────────

test("settings page opens from top bar gear icon", async ({ page }) => {
  await setup(page);
  await page.locator('button[aria-label="Open settings"]').click();
  await page.waitForURL(/\/settings/, { timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
