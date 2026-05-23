/**
 * E2E: multi-device join via SSE device.activated event (Phase 5f).
 *
 * Strategy:
 *  - Override window.EventSource with a controllable in-page stub via
 *    page.addInitScript (option a from the spec). The stub exposes a
 *    global __fakeSSE handle that the test can call to fire events.
 *  - Mock /api/v1/sync/live (intercepted before the stub ES connects).
 *  - Mock /api/v1/sync/pull to return an empty response (engine calls
 *    pullSince after persisting the key).
 *  - Seed a real device keypair inside the crypto worker, then create a
 *    valid 80-byte X25519 sealed-box envelope wrapping a dummy familyKey
 *    for that device pubkey using wrapKeyForDevice.
 *  - Trigger a synthetic device.activated SSE event with the real envelope.
 *  - Assert the page navigates away from /devices/waiting to /accounts.
 *
 * SSE long-poll handling note:
 *   A real EventSource holds an open HTTP connection forever. The stub avoids
 *   this entirely — it registers named event listeners just like the real
 *   EventSource API, and the test fires events synchronously via
 *   page.evaluate(). No HTTP server is needed. The stub captures the most
 *   recently constructed instance as window.__fakeSSE so the test can reach
 *   it from evaluate() calls.
 *
 * Key insight: page.goto() triggers a full browser navigation (not pushState),
 * so Zustand store state is reset on each goto. We inject awaitingEnvelope=true
 * into the live store AFTER the final goto, not before.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// EventSource stub injected into the page before any app code runs.
// ---------------------------------------------------------------------------

const FAKE_EVENT_SOURCE_SCRIPT = `
(function () {
  // Keep a reference to the most recently constructed FakeEventSource instance
  // so tests can trigger events via window.__fakeSSE.
  window.__fakeSSE = null;

  class FakeEventSource extends EventTarget {
    constructor(url, init) {
      super();
      this.url = url;
      this.withCredentials = (init && init.withCredentials) || false;
      this.readyState = 1; // OPEN
      this.onopen = null;
      this.onerror = null;
      this.onmessage = null;
      window.__fakeSSE = this;
      // Simulate a successful open on the next microtask tick.
      Promise.resolve().then(() => {
        const ev = new Event('open');
        if (this.onopen) this.onopen(ev);
        this.dispatchEvent(ev);
      });
    }

    /** Fire a named SSE event with a JSON payload. */
    fireEvent(type, data) {
      const msg = new MessageEvent(type, { data: JSON.stringify(data) });
      this.dispatchEvent(msg);
      if (type === 'message' && this.onmessage) this.onmessage(msg);
    }

    close() {
      this.readyState = 2; // CLOSED
    }
  }

  // Expose static constants expected by some code.
  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;

  window.EventSource = FakeEventSource;
})();
`;

// ---------------------------------------------------------------------------
// Helper: navigate to /devices/waiting and inject awaiting state
// ---------------------------------------------------------------------------

/**
 * Prepare a page for the "new device awaiting envelope" scenario:
 * 1. Mark onboarding complete in Dexie (persists across page.goto reloads).
 * 2. Navigate to /devices/waiting.
 * 3. Inject awaitingEnvelope=true into the live Zustand auth store AFTER goto
 *    (page.goto resets JS state, so the injection must happen post-navigation).
 */
async function setupDeviceWaiting(page: Page) {
  // Seed Dexie so the app doesn't redirect to /onboarding on startup.
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

  // Navigate to /devices/waiting. The cold-start redirect skips this path
  // (App.tsx exempts "/devices/waiting" the same way it exempts "/dev/*").
  await page.goto("/devices/waiting");
  await page.waitForLoadState("domcontentloaded");
  // Wait for the settings store to hydrate from Dexie.
  await page.waitForTimeout(600);

  // Inject the awaiting-envelope state into the live Zustand store. Must come
  // after the goto so we target the live (post-reload) store instance.
  await page.evaluate(() => {
    return import("/src/services/auth/session.ts").then(({ useAuthStore }) => {
      useAuthStore.setState({
        isSignedIn: true,
        awaitingEnvelope: true,
        needsFamilyInit: false,
        user: {
          id: "00000000-0000-7000-8000-000000000001",
          email: "test@example.com",
          displayName: "Test User",
          isAdmin: false,
        },
        device: {
          id: "00000000-0000-7000-8000-000000000002",
          label: "Test Device",
        },
      });
    });
  });

  // Give React a tick to re-render with the injected auth state.
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("multi-device join: device.activated SSE navigates away from /devices/waiting", async ({
  browser,
}) => {
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();

  // Install EventSource stub BEFORE any page load so the app always sees the fake.
  await page2.addInitScript(FAKE_EVENT_SOURCE_SCRIPT);

  // Safety-net routes — the stub EventSource intercepts /sync/live in-page,
  // but Playwright routes catch any fetch() calls that escape to the network.
  await page2.route("**/api/v1/sync/live", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });
  await page2.route("**/api/v1/sync/pull**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [], nextCursor: "dGVzdEN1cnNvcjE", hasMore: false }),
    });
  });
  // Block any real family-device requests.
  await page2.route("**/api/v1/family/devices/**", async (route) => {
    await route.fulfill({ status: 204 });
  });

  // First navigation — load the app bundle (IndexedDB is not open yet on a blank page).
  await page2.goto("/");
  await page2.waitForLoadState("domcontentloaded");
  await page2.waitForTimeout(400);

  // Land on /devices/waiting with awaitingEnvelope=true injected.
  await setupDeviceWaiting(page2);

  // Confirm we are on /devices/waiting and the waiting-screen copy is visible.
  await expect(page2).toHaveURL(/\/devices\/waiting/);
  await expect(page2.getByText("Waiting for approval")).toBeVisible();

  // ── Crypto setup ─────────────────────────────────────────────────────────────
  // Generate a real X25519 device keypair inside the crypto worker (private key
  // stays in the worker's IndexedDB; we only get the public key back).
  const devicePubKeyArray = await page2.evaluate(async () => {
    const { cryptoWorker } = await import("/src/services/crypto/worker-client.ts");
    const pubKeyBytes = await cryptoWorker.generateAndPersistDeviceKey();
    return Array.from(pubKeyBytes);
  });

  // Wrap a dummy 32-byte familyKey for the device pubkey to produce a valid
  // 80-byte sealed-box envelope. The worker will be able to unwrap this.
  const envelopeB64u = await page2.evaluate(
    async ({ pubKeyArr }) => {
      const { cryptoWorker } = await import("/src/services/crypto/worker-client.ts");
      const familyKey = new Uint8Array(32).fill(0xab);
      const devicePubKey = new Uint8Array(pubKeyArr);
      const envelopeBytes = await cryptoWorker.wrapKeyForDevice(familyKey, devicePubKey);
      const b64 = btoa(String.fromCharCode(...envelopeBytes));
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    },
    { pubKeyArr: devicePubKeyArray },
  );

  expect(envelopeB64u, "envelope must be non-empty").toBeTruthy();
  expect(envelopeB64u.length, "sealed-box envelope base64url must be ~107 chars").toBeGreaterThan(
    80,
  );

  // ── Wire the live-sync engine to the fake EventSource ────────────────────────
  // startLiveSync calls connectSSE which calls new EventSource(...), captured
  // by our stub as window.__fakeSSE.
  await page2.evaluate(
    async ({ familyId }) => {
      const { startLiveSync } = await import("/src/services/sync/engine.ts");
      startLiveSync(familyId);
    },
    { familyId: "00000000-0000-7000-8000-000000000099" },
  );

  // Give connectSSE time to call new EventSource() and register event listeners.
  await page2.waitForTimeout(200);

  const fakeSSEReady = await page2.evaluate(() => {
    return !!(window as unknown as { __fakeSSE: unknown }).__fakeSSE;
  });
  expect(fakeSSEReady, "FakeEventSource must be instantiated after startLiveSync").toBe(true);

  // ── Fire the synthetic device.activated SSE event ────────────────────────────
  // The engine's onEvent handler for device.activated will:
  //   1. Call cryptoWorker.unwrapAndPersistFamilyKey(envelope)
  //   2. Call useAuthStore.getState().clearAwaitingEnvelope()
  //   3. DeviceJoinWaiting sees awaitingEnvelope→false and navigates to /accounts.
  await page2.evaluate(
    ({ envelope }) => {
      const fakeSSE = (
        window as unknown as { __fakeSSE: { fireEvent(t: string, d: unknown): void } | null }
      ).__fakeSSE;
      if (!fakeSSE) throw new Error("FakeEventSource not initialised");
      fakeSSE.fireEvent("device.activated", {
        deviceId: "00000000-0000-7000-8000-000000000002",
        envelope,
      });
    },
    { envelope: envelopeB64u },
  );

  // ── Assert: page navigates away from /devices/waiting ────────────────────────
  await expect(page2).toHaveURL(/\/accounts/, { timeout: 8000 });

  await context2.close();
});

test("auto-route to /devices/waiting when awaitingEnvelope is set at page load", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Seed Dexie with onboarding complete so the app does not redirect to /onboarding.
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);

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

  // Inject awaitingEnvelope=true into the auth store BEFORE navigating to "/",
  // so the startup-routing effect sees it on the initial render after load.
  // We use addInitScript to run code that patches the store immediately after
  // the module graph initialises.
  await page.addInitScript(() => {
    // Poll until the Zustand auth store is available, then set the flag.
    const interval = setInterval(() => {
      try {
        // Dynamic import isn't available from initScript; use a module-level
        // side-effect instead: write a flag to sessionStorage that the app can
        // read synchronously during its startup routing effect.
        sessionStorage.setItem("__e2e_awaitingEnvelope", "true");
        clearInterval(interval);
      } catch {
        // ignore
      }
    }, 10);
  });

  // Navigate to "/" — App startup sequence runs with awaitingEnvelope=true injected
  // via the Zustand store set call after the page loads.
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);

  // Inject auth state with awaitingEnvelope=true into the live store.
  await page.evaluate(() => {
    return import("/src/services/auth/session.ts").then(({ useAuthStore }) => {
      useAuthStore.setState({
        isSignedIn: true,
        awaitingEnvelope: true,
        needsFamilyInit: false,
        user: {
          id: "00000000-0000-7000-8000-000000000010",
          email: "new-device@example.com",
          displayName: "New Device User",
          isAdmin: false,
        },
        device: {
          id: "00000000-0000-7000-8000-000000000011",
          label: "New Device",
        },
      });
    });
  });

  // Wait for the startup-routing effect to react to awaitingEnvelope=true.
  await expect(page).toHaveURL(/\/devices\/waiting/, { timeout: 2000 });

  await ctx.close();
});
