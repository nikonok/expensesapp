/**
 * E2E: lose-all-devices recovery flow (Phase 6e).
 *
 * Scenario: A user has lost all their devices and needs to recover access
 * using their 24-word recovery phrase on a fresh device.
 *
 * Simplifications (documented per spec):
 *  - cryptoWorker.unwrapRecoveryEnvelopeAndPersist and
 *    cryptoWorker.wrapStoredFamilyKeyForDevice are stubbed to no-op success
 *    via page.evaluate() after the module is loaded. The point of this e2e
 *    is the UI flow, not crypto correctness — unit tests cover crypto.
 *  - A fixed valid 24-word BIP39 phrase is typed directly into the 24 inputs.
 *    (No need to simulate a Device 1 onboarding ceremony for the phrase.)
 *  - Backend endpoints are mocked via page.route(); the recovery-envelope
 *    response includes a familyId field so DeviceJoinWaiting can unwrap.
 *  - The 30s timer to show RecoveryCodeEntry is bypassed by clicking
 *    "Enter recovery code instead" which is always visible.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A valid 24-word BIP39 mnemonic (all words from the standard English wordlist).
// Chosen to be all valid words — crypto ops are stubbed so correctness doesn't matter.
const RECOVERY_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

const FAMILY_ID = "00000000-0000-7000-8000-000000000099";
const DEVICE_ID = "00000000-0000-7000-8000-000000000002";
const USER_ID = "00000000-0000-7000-8000-000000000001";

// ---------------------------------------------------------------------------
// Helper: seed Dexie and navigate to /devices/waiting
// ---------------------------------------------------------------------------

/**
 * Prepare a fresh-device page for the recovery scenario:
 * 1. Open the app at "/" so Dexie initialises.
 * 2. Seed settings (onboarding complete, startup screen = accounts).
 * 3. Navigate to /devices/waiting.
 * 4. Inject awaitingEnvelope=true into the Zustand auth store.
 */
async function setupFreshDeviceWaiting(page: Page) {
  // First load: open the app bundle so IndexedDB schema is created.
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);

  // Seed Dexie so the app does not redirect to /onboarding.
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

  // Navigate to /devices/waiting.
  await page.goto("/devices/waiting");
  await page.waitForLoadState("domcontentloaded");
  // Wait for settings store to hydrate from Dexie.
  await page.waitForTimeout(600);

  // Inject auth state with awaitingEnvelope=true. Must happen after goto
  // (page.goto resets JS state).
  await page.evaluate(
    ({ userId, deviceId }) => {
      return import("/src/services/auth/session.ts").then(({ useAuthStore }) => {
        useAuthStore.setState({
          isSignedIn: true,
          awaitingEnvelope: true,
          needsFamilyInit: false,
          user: {
            id: userId,
            email: "recovery-test@example.com",
            displayName: "Recovery Test User",
            isAdmin: false,
          },
          device: {
            id: deviceId,
            label: "Fresh Device (2026-05-23)",
          },
        });
      });
    },
    { userId: USER_ID, deviceId: DEVICE_ID },
  );

  // Give React a tick to re-render with injected auth state.
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Helper: stub crypto worker methods to no-op success
// ---------------------------------------------------------------------------

/**
 * After the crypto worker module is loaded in the page, patch the two methods
 * used by the recovery flow so they resolve immediately without doing real
 * Argon2id derivation or libsodium decryption.
 *
 * This must be called AFTER the module is imported (i.e. after the page has
 * reached the step where DeviceJoinWaiting's handleRecoverySubmit runs, or
 * we force the import first and then patch).
 */
async function stubCryptoWorkerForRecovery(page: Page) {
  await page.evaluate(() => {
    return import("/src/services/crypto/worker-client.ts").then(({ cryptoWorker }) => {
      // Stub: unwrap Envelope A + persist familyKey → immediate success, no-op.
      (cryptoWorker as Record<string, unknown>).unwrapRecoveryEnvelopeAndPersist = () =>
        Promise.resolve();

      // Stub: wrap stored familyKey for self-device upload → return dummy b64url string.
      (cryptoWorker as Record<string, unknown>).wrapStoredFamilyKeyForDevice = () =>
        Promise.resolve("ZHVtbXlFbnZlbG9wZQ"); // "dummyEnvelope" in base64url
    });
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("recovery flow: fresh device recovers via 24-word phrase and navigates to /accounts", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // ── Route mocks ──────────────────────────────────────────────────────────────

  // GET /api/v1/family/recovery-envelope — return a dummy Envelope A (base64url)
  // plus familyId so DeviceJoinWaiting can perform the AAD-based unwrap.
  // The recoveryWrap bytes don't need to be cryptographically valid because the
  // unwrapRecoveryEnvelopeAndPersist worker call is stubbed to a no-op.
  // Minimum valid format: 1 (ver) + 24 (nonce) + 48 (ct, 32-byte pt + 16-byte tag).
  // We just send 73 bytes of zeros encoded as base64url.
  const dummyRecoveryWrap = Buffer.alloc(73).toString("base64url");
  const dummySalt = Buffer.alloc(16).toString("base64url");

  await page.route("**/api/v1/family/recovery-envelope", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recoveryWrap: dummyRecoveryWrap,
        salt: dummySalt,
        version: 1,
        createdAt: "2026-05-23T00:00:00Z",
        familyId: FAMILY_ID,
      }),
    });
  });

  // GET /api/v1/me/devices/:id — return a dummy device public key (base64url).
  await page.route(`**/api/v1/me/devices/${DEVICE_ID}`, async (route) => {
    // 32-byte dummy X25519 pub key (all zeros is not a valid curve point, but the
    // wrapStoredFamilyKeyForDevice worker call is stubbed so it doesn't matter).
    const dummyPubKey = Buffer.alloc(32).toString("base64url");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pubKey: dummyPubKey }),
    });
  });

  // POST /api/v1/family/devices/:id/envelope — accept self-upload.
  await page.route(`**/api/v1/family/devices/${DEVICE_ID}/envelope`, async (route) => {
    await route.fulfill({ status: 204 });
  });

  // Catch-all for any other API calls that might escape (sync, etc.).
  await page.route("**/api/v1/sync/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [], nextCursor: "dGVzdA", hasMore: false }),
    });
  });

  // ── Setup: land on /devices/waiting with awaitingEnvelope=true ───────────────
  await setupFreshDeviceWaiting(page);

  // Confirm we are on /devices/waiting and the waiting-screen is visible.
  await expect(page).toHaveURL(/\/devices\/waiting/);
  await expect(page.getByText("Waiting for approval")).toBeVisible();

  // ── Pre-stub: patch the crypto worker before the recovery path fires ──────────
  // Import the module now so the singleton is initialised, then patch its methods.
  await stubCryptoWorkerForRecovery(page);

  // ── Trigger recovery UI (bypass the 30s timer by clicking the link) ───────────
  await page.getByRole("button", { name: /enter recovery code instead/i }).click();

  // The recovery entry heading should now be visible.
  await expect(page.getByText("Recover access")).toBeVisible({ timeout: 3000 });

  // Confirm the 24-input grid is present by checking for word 1 and word 24.
  await expect(page.getByRole("textbox", { name: "Word 1", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Word 24", exact: true })).toBeVisible();

  // ── Type the 24-word phrase ───────────────────────────────────────────────────
  const words = RECOVERY_PHRASE.split(" ");
  for (let i = 0; i < words.length; i++) {
    // Each input carries aria-label "Word N" — use exact match to avoid "Word 1"
    // matching "Word 10", "Word 11", etc.
    await page.getByRole("textbox", { name: `Word ${i + 1}`, exact: true }).fill(words[i]);
  }

  // All 24 inputs filled → "Restore access" button should be enabled.
  const restoreBtn = page.getByRole("button", { name: /restore access/i });
  await expect(restoreBtn).toBeEnabled({ timeout: 2000 });

  // ── Submit ────────────────────────────────────────────────────────────────────
  await restoreBtn.click();

  // ── Assert: page navigates away from /devices/waiting to /accounts ────────────
  await expect(page).toHaveURL(/\/accounts/, { timeout: 10000 });

  await context.close();
});
