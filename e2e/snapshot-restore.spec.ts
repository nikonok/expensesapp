/**
 * E2E: snapshot restore flow (Phase 8f).
 *
 * Strategy:
 *  - Mock /api/v1/snapshots to return one snapshot entry.
 *  - Mock /api/v1/snapshots/:date/restore to return { newCursor: 1 }.
 *  - Mock /api/v1/sync/pull to return an empty list (post-restore sync).
 *  - Override window.EventSource with a controllable stub (same pattern as
 *    multi-device-join.spec.ts) to simulate the sync.barrier SSE event.
 *  - Walk: Settings → BackupSettings → expand snapshot card → click Restore
 *    on the row → confirm dialog → assert success toast "Restored.".
 */

import { test, expect, type Page } from "@playwright/test";
import { setup } from "./helpers";

// ---------------------------------------------------------------------------
// EventSource stub — controllable from the test via window.__fakeSSE.
// Same pattern used in multi-device-join.spec.ts.
// ---------------------------------------------------------------------------

const FAKE_EVENT_SOURCE_SCRIPT = `
(function () {
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

    close() {
      this.readyState = 2; // CLOSED
    }
  }

  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;

  window.EventSource = FakeEventSource;
})();
`;

// ---------------------------------------------------------------------------
// Navigate to Settings (gear icon).
// ---------------------------------------------------------------------------

async function openSettings(page: Page) {
  await page.locator('button[aria-label="Open settings"]').click({ force: true });
  await page.waitForURL(/\/settings/, { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("snapshot restore: expand card → confirm restore → success toast", async ({ page }) => {
  // Install the EventSource stub before any page code runs.
  await page.addInitScript(FAKE_EVENT_SOURCE_SCRIPT);

  // Mock SSE live endpoint (fallback in case any real fetch escapes the stub).
  await page.route("**/api/v1/sync/live", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });

  // Mock snapshots list.
  await page.route("**/api/v1/snapshots", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        snapshots: [
          {
            snapshotId: "snap-abc",
            date: "2026-05-20",
            createdAt: "2026-05-20T03:00:00Z",
            expiresAt: "2026-06-19T03:00:00Z",
          },
        ],
      }),
    });
  });

  // Capture restore calls and respond with newCursor.
  let restoreCalled = false;
  await page.route("**/api/v1/snapshots/2026-05-20/restore*", async (route) => {
    restoreCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ newCursor: 42 }),
    });
  });

  // Mock post-restore pull (engine calls pullSince after restore).
  await page.route("**/api/v1/sync/pull**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [], nextCursor: "dGVzdA", hasMore: false }),
    });
  });

  // Boot app.
  await setup(page);

  // Navigate to Settings.
  await openSettings(page);
  await page.waitForTimeout(400);

  // Expand the "Restore from snapshot" card (the toggle button).
  // The SnapshotRestore component renders a <button> wrapping a <span> with this text.
  await page.locator("button", { hasText: "Restore from snapshot" }).click({ force: true });

  // Wait for the snapshot row to appear (date "2026-05-20").
  await expect(page.getByText("2026-05-20")).toBeVisible({ timeout: 6000 });

  // Click the "Restore" button on the snapshot row (not any confirm-dialog button).
  // The row button is the only "Restore" button visible at this point.
  const rowRestoreBtn = page.locator("button", { hasText: "Restore" }).last();
  await expect(rowRestoreBtn).toBeVisible({ timeout: 4000 });
  await rowRestoreBtn.click({ force: true });

  // Wait for the ConfirmDialog to appear (role=dialog).
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 4000 });

  // Click the Restore confirm button inside the dialog.
  const confirmBtn = dialog.getByRole("button", { name: "Restore" });
  await expect(confirmBtn).toBeVisible({ timeout: 4000 });
  await confirmBtn.click({ force: true });

  // Assert the restore API was called.
  await page.waitForTimeout(600);
  expect(restoreCalled).toBe(true);

  // Assert success toast "Restored." is visible.
  await expect(page.getByText("Restored.")).toBeVisible({ timeout: 6000 });
});
