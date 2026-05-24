/**
 * E2E: Admin panel — users table + allowlist (Phase 10f).
 *
 * Strategy:
 *  - Seed Dexie (onboarding complete) and navigate to /.
 *  - Inject isAdmin=true into the Zustand auth store so AdminRoute passes.
 *  - Navigate to /admin.
 *  - Mock /api/v1/admin/users to return 2 users.
 *  - Assert the users table renders both rows.
 *  - Click "Suspend" on the first user → ConfirmDialog appears → confirm →
 *    assert the backend POST was issued.
 *  - Click "Allowlist" nav → mock /api/v1/admin/allowlist → assert entries load →
 *    fill the add-email form → assert POST /api/v1/admin/allowlist fires.
 */

import { test, expect, type Page } from "@playwright/test";
import { setup } from "./helpers";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const USER_A = {
  id: "user-a-id-0000-0000-0000-000000000001",
  email: "alice@example.com",
  displayName: "Alice",
  lastSignInAt: "2026-05-20T10:00:00Z",
  suspendedAt: null,
  isAdmin: false,
  isRoot: false,
  promoterId: null,
  storageUsagePct: 3,
  familyMemberCount: 1,
  deviceCount: 1,
  hasRecoveryCode: false,
  deletePending: false,
};

const USER_B = {
  id: "user-b-id-0000-0000-0000-000000000002",
  email: "bob@example.com",
  displayName: "Bob",
  lastSignInAt: "2026-05-21T08:30:00Z",
  suspendedAt: null,
  isAdmin: false,
  isRoot: false,
  promoterId: null,
  storageUsagePct: 0,
  familyMemberCount: 1,
  deviceCount: 2,
  hasRecoveryCode: false,
  deletePending: false,
};

// ---------------------------------------------------------------------------
// Helper: set up the page as an admin
// ---------------------------------------------------------------------------

async function setupAdmin(page: Page) {
  // Boot app with onboarding complete (navigates to /accounts via setup()).
  await setup(page);

  // Inject admin auth state while on /accounts, then use a client-side navigation
  // (window.history.pushState + popstate) to move to /admin without a full page
  // reload — so the injected Zustand state persists.
  await page.evaluate(() => {
    return import("/src/services/auth/session.ts").then(({ useAuthStore }) => {
      useAuthStore.setState({
        isSignedIn: true,
        needsFamilyInit: false,
        awaitingEnvelope: false,
        user: {
          id: "admin-user-id-0001",
          email: "admin@example.com",
          displayName: "Admin User",
          isAdmin: true,
        },
        device: {
          id: "admin-device-id-0001",
          label: "Admin Browser",
        },
      });
      // Client-side navigation to /admin.
      window.history.pushState({}, "", "/admin");
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });
  });

  // Give React Router + React a tick to render the /admin route.
  await page.waitForURL(/\/admin/, { timeout: 8000 });
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Test: users table renders and suspend action works
// ---------------------------------------------------------------------------

test("admin panel: users table renders; suspend fires POST", async ({ page }) => {
  // Mock the SSE endpoint to prevent open connections.
  await page.route("**/api/v1/sync/live", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });

  // Mock users list endpoint — backend returns { items, limit, offset }.
  await page.route("**/api/v1/admin/users**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [USER_A, USER_B],
        limit: 50,
        offset: 0,
      }),
    });
  });

  // Track suspend calls.
  let suspendCalledForId = "";
  await page.route("**/api/v1/admin/users/*/suspend", async (route) => {
    const url = route.request().url();
    const match = url.match(/\/users\/([^/]+)\/suspend/);
    if (match) suspendCalledForId = match[1];
    await route.fulfill({ status: 204, body: "" });
  });

  // setupAdmin injects isAdmin=true and client-side navigates to /admin.
  await setupAdmin(page);

  // Both users must be visible (exact match avoids matching email addresses too).
  await expect(page.getByText("Alice", { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.getByText("Bob", { exact: true })).toBeVisible({ timeout: 6000 });

  // The count line should mention "2 users loaded".
  await expect(page.getByText(/2 user/)).toBeVisible({ timeout: 4000 });

  // Click "Suspend" on the first user row (Alice's row).
  // Suspend fires immediately — no confirm dialog (only "Force sign-out" uses one).
  const suspendBtn = page.locator("button", { hasText: "Suspend" }).first();
  await expect(suspendBtn).toBeVisible({ timeout: 4000 });
  await suspendBtn.click({ force: true });

  // Wait for the POST to fire and Alice's row to flip to "Suspended".
  await page.waitForTimeout(600);
  expect(suspendCalledForId).toBe(USER_A.id);
});

// ---------------------------------------------------------------------------
// Test: allowlist nav → entries load → add email fires POST
// ---------------------------------------------------------------------------

test("admin panel: allowlist nav shows entries; add email fires POST", async ({ page }) => {
  // Mock the SSE endpoint.
  await page.route("**/api/v1/sync/live", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });

  // Mock users list (needed for initial load of the Users section).
  await page.route("**/api/v1/admin/users**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [USER_A], limit: 50, offset: 0 }),
    });
  });

  // Single handler for all /api/v1/admin/allowlist requests.
  // GET  → return mocked entries (plain array — listAllowlist() handles both shapes).
  // POST → capture body and return 204.
  let addAllowlistBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/admin/allowlist", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            email: "existing@example.com",
            addedBy: "admin-user-id-0001",
            addedAt: "2026-05-01T00:00:00Z",
            note: null,
          },
        ]),
      });
      return;
    }
    if (route.request().method() === "POST") {
      try {
        addAllowlistBody = JSON.parse(route.request().postData() ?? "{}");
      } catch {}
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.continue();
  });

  // setupAdmin injects isAdmin=true and client-side navigates to /admin.
  await setupAdmin(page);

  // Click the "Allowlist" nav item in the sidebar.
  await page.locator("button", { hasText: "Allowlist" }).click({ force: true });
  await page.waitForTimeout(400);

  // Existing allowlist entry must be visible.
  await expect(page.getByText("existing@example.com")).toBeVisible({ timeout: 6000 });

  // Fill and submit the add-email form.
  const emailInput = page.locator('input[type="email"]');
  await emailInput.fill("new-member@example.com");

  const addBtn = page.locator("button", { hasText: "Add" });
  await expect(addBtn).toBeVisible({ timeout: 4000 });
  await addBtn.click({ force: true });

  // Wait for the POST to fire.
  await page.waitForTimeout(600);
  expect(addAllowlistBody).not.toBeNull();
  expect((addAllowlistBody as Record<string, unknown>).email).toBe("new-member@example.com");
});
