/**
 * E2E: family invite / accept / remove lifecycle (Phase 7f).
 *
 * Strategy:
 *  - Single browser, two independent contexts (User A = inviter/admin,
 *    User B = invitee). Each context gets its own IndexedDB, cookie jar,
 *    and route-mock layer so they are fully isolated.
 *  - All backend API calls are intercepted with route mocks.
 *  - SSE events are delivered via the FakeEventSource stub.
 *
 * Scenario:
 *  1. User A opens Settings → Family, sends invite to User B.
 *  2. User B opens Settings → Family, sees the invite, clicks Accept.
 *  3. User A removes User B; User B receives you.removed SSE and is signed out.
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVITE_ID = "00000000-0000-7000-8000-aabbccddeeff";
const FAMILY_ID = "00000000-0000-7000-8000-aabbccddeef1";
const USER_A_ID = "00000000-0000-7000-8000-000000000001";
const USER_B_ID = "00000000-0000-7000-8000-000000000002";
const USER_B_EMAIL = "bob@example.com";

// ---------------------------------------------------------------------------
// EventSource stub
// ---------------------------------------------------------------------------

const FAKE_EVENT_SOURCE_SCRIPT = `
(function () {
  window.__fakeSSE = null;

  class FakeEventSource extends EventTarget {
    constructor(url, init) {
      super();
      this.url = url;
      this.withCredentials = (init && init.withCredentials) || false;
      this.readyState = 1;
      this.onopen = null;
      this.onerror = null;
      this.onmessage = null;
      window.__fakeSSE = this;
      Promise.resolve().then(() => {
        const ev = new Event('open');
        if (this.onopen) this.onopen(ev);
        this.dispatchEvent(ev);
      });
    }

    fireEvent(type, data) {
      const msg = new MessageEvent(type, { data: JSON.stringify(data) });
      this.dispatchEvent(msg);
      if (type === 'message' && this.onmessage) this.onmessage(msg);
    }

    close() { this.readyState = 2; }
  }

  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;
  window.EventSource = FakeEventSource;
})();
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedOnboarding(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("settings", "readwrite");
        const store = tx.objectStore("settings");
        store.put({ key: "hasCompletedOnboarding", value: true });
        store.put({ key: "startupScreen", value: "accounts" });
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

async function injectAuthState(page: Page, userId: string, email: string, displayName: string) {
  await page.evaluate(
    (s) => {
      return import("/src/services/auth/session.ts").then(({ useAuthStore }) => {
        useAuthStore.setState({
          isSignedIn: true,
          awaitingEnvelope: false,
          needsFamilyInit: false,
          user: { id: s.userId, email: s.email, displayName: s.displayName, isAdmin: false },
          device: { id: "00000000-0000-7000-8000-000000000099", label: "Test Device" },
        });
      });
    },
    { userId, email, displayName },
  );
}

/**
 * Create a page in the given context, install the EventSource stub,
 * set up common route mocks, seed onboarding, and return a ready page
 * that is parked on /accounts with auth state injected.
 */
async function bootstrapPage(
  context: BrowserContext,
  userId: string,
  email: string,
  displayName: string,
): Promise<Page> {
  const page = await context.newPage();

  await page.addInitScript(FAKE_EVENT_SOURCE_SCRIPT);

  // Intercept SSE stream.
  await page.route("**/api/v1/sync/live", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: ": keepalive\n\n" }),
  );

  // Intercept sync/pull.
  await page.route("**/api/v1/sync/pull**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [], nextCursor: "dGVzdA", hasMore: false }),
    }),
  );

  // First load to open IndexedDB.
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);

  // Seed settings so onboarding redirect is skipped.
  await seedOnboarding(page);

  // Navigate to accounts (cold-start target).
  await page.goto("/accounts");
  await page.waitForURL(/\/accounts/, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Inject signed-in auth state.
  await injectAuthState(page, userId, email, displayName);
  await page.waitForTimeout(200);

  return page;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("family invite → accept → remove lifecycle", async ({ browser }) => {
  // ── User A context ────────────────────────────────────────────────────────
  const ctxA = await browser.newContext();
  const pageA = await bootstrapPage(ctxA, USER_A_ID, "alice@example.com", "Alice");

  // Mock family API for User A's Settings page.
  // GET /family/members → Alice only.
  await pageA.route("**/api/v1/family/members", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          userId: USER_A_ID,
          email: "alice@example.com",
          displayName: "Alice",
          joinedAt: new Date().toISOString(),
          isSelf: true,
        },
      ]),
    });
  });

  // GET /family/invites/incoming → empty (no pending invites for User A).
  await pageA.route("**/api/v1/family/invites/incoming", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ invites: [] }),
    }),
  );

  // POST /family/invites → success.
  await pageA.route("**/api/v1/family/invites", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ inviteId: INVITE_ID, expiresAt: new Date().toISOString() }),
    });
  });

  // Navigate to settings via the gear button (avoids cold-start redirect that
  // would fire if we used goto("/settings") directly).
  await pageA.getByRole("button", { name: "Open settings" }).click();
  await pageA.waitForURL(/\/settings/, { timeout: 8000 });
  await pageA.waitForTimeout(600);

  // The invite input should be present.
  const inviteInput = pageA.locator('input[placeholder="Invite by email"]');
  await expect(inviteInput).toBeVisible({ timeout: 8000 });

  // Fill and submit.
  await inviteInput.fill(USER_B_EMAIL);
  await pageA.getByRole("button", { name: "Send" }).click();

  // Toast confirmation.
  await expect(pageA.getByText("Invite sent")).toBeVisible({ timeout: 5000 });

  // ── User B context ────────────────────────────────────────────────────────
  const ctxB = await browser.newContext();
  const pageB = await bootstrapPage(ctxB, USER_B_ID, USER_B_EMAIL, "Bob");

  // GET /family/invites/incoming → one invite from Alice.
  // Shape matches the backend response envelope { invites: [...] }.
  // Each item uses the fields the Invite interface and FamilySettings component render.
  await pageB.route("**/api/v1/family/invites/incoming", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        invites: [
          {
            inviteId: INVITE_ID,
            familyId: FAMILY_ID,
            invitedBy: USER_A_ID,
            inviteeEmail: USER_B_EMAIL,
            inviterEmail: "alice@example.com",
            inviterDisplayName: "Alice",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
    }),
  );

  // GET /family/members → Bob only (solo).
  await pageB.route("**/api/v1/family/members", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          userId: USER_B_ID,
          email: USER_B_EMAIL,
          displayName: "Bob",
          joinedAt: new Date().toISOString(),
          isSelf: true,
        },
      ]),
    });
  });

  // POST /family/invites/{id}/accept → 204.
  await pageB.route(`**/api/v1/family/invites/${INVITE_ID}/accept`, (route) =>
    route.fulfill({ status: 204 }),
  );

  // Navigate User B to settings via gear button.
  await pageB.getByRole("button", { name: "Open settings" }).click();
  await pageB.waitForURL(/\/settings/, { timeout: 8000 });
  await pageB.waitForTimeout(600);

  // Accept and Decline buttons should be visible (invite from Alice).
  const acceptButton = pageB.getByRole("button", { name: "Accept" });
  await expect(acceptButton).toBeVisible({ timeout: 8000 });

  await acceptButton.click();

  // Toast confirmation.
  await expect(pageB.getByText("Joined family!")).toBeVisible({ timeout: 5000 });

  // ── User A removes User B ─────────────────────────────────────────────────

  // Replace family member mock with Alice + Bob.
  await pageA.unroute("**/api/v1/family/members");
  await pageA.route("**/api/v1/family/members", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          userId: USER_A_ID,
          email: "alice@example.com",
          displayName: "Alice",
          joinedAt: new Date().toISOString(),
          isSelf: true,
        },
        {
          userId: USER_B_ID,
          email: USER_B_EMAIL,
          displayName: "Bob",
          joinedAt: new Date().toISOString(),
          isSelf: false,
        },
      ]),
    });
  });

  // POST /family/members/{userId}/remove → 204.
  await pageA.route(`**/api/v1/family/members/${USER_B_ID}/remove`, (route) =>
    route.fulfill({ status: 204 }),
  );

  // Navigate back to accounts then to settings so FamilySettings re-mounts with fresh data.
  await pageA
    .getByRole("button", { name: "Back" })
    .first()
    .click()
    .catch(async () => {
      // If no Back button, navigate via the browser's router.
      await pageA.evaluate(() => window.history.back());
    });
  await pageA.waitForURL(/\/accounts/, { timeout: 5000 }).catch(() => {
    /* already on accounts */
  });
  await pageA.waitForTimeout(200);
  await pageA.getByRole("button", { name: "Open settings" }).click();
  await pageA.waitForURL(/\/settings/, { timeout: 8000 });
  await pageA.waitForTimeout(600);

  // Bob's "Remove" button should be visible.
  const removeButton = pageA.getByRole("button", { name: "Remove" });
  await expect(removeButton).toBeVisible({ timeout: 8000 });
  await removeButton.click();

  // Toast "Member removed".
  await expect(pageA.getByText("Member removed")).toBeVisible({ timeout: 5000 });

  // ── User B receives you.removed SSE ───────────────────────────────────────

  // Wire the live-sync engine so __fakeSSE is created.
  await pageB.evaluate(async () => {
    const { startLiveSync } = await import("/src/services/sync/engine.ts");
    startLiveSync("00000000-0000-7000-8000-aabbccddeef1");
  });
  await pageB.waitForTimeout(200);

  // Mock sign-out endpoint that the engine calls after data wipe.
  await pageB.route("**/api/v1/auth/signout", (route) => route.fulfill({ status: 204 }));

  // Fire you.removed.
  await pageB.evaluate(
    ({ familyId }) => {
      const fakeSSE = (
        window as unknown as { __fakeSSE: { fireEvent(t: string, d: unknown): void } | null }
      ).__fakeSSE;
      if (!fakeSSE) throw new Error("FakeEventSource not initialised");
      fakeSSE.fireEvent("you.removed", { familyId, reason: "kicked" });
    },
    { familyId: FAMILY_ID },
  );

  // After wipe + signOut, the app should redirect to /onboarding.
  await expect(pageB).toHaveURL(/\/onboarding/, { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});
