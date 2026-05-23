/**
 * E2E: single-device push/pull round-trip (Phase 4g).
 *
 * All /api/v1/sync/* calls are intercepted via page.route() — no real Go server.
 *
 * Flow:
 *  1. Setup: mark onboarding complete, seed a 32-byte familyKey into the worker's
 *     IndexedDB (cipherKeys store) so encryptRecordWithStoredKey / decryptRecordWithStoredKey
 *     work without going through the full wrapAndPersistFamilyKey ceremony.
 *  2. Generate a real device keypair (needed by the worker to be fully initialised).
 *  3. Call enqueuePush() from the engine — this encrypts with the stored familyKey
 *     and stores the envelope in pendingUploads.
 *  4. Capture the encrypted blob by reading pendingUploads from IndexedDB, then
 *     configure the pull mock to return it.
 *  5. flushOutbox() — mocked POST /api/v1/sync/push accepts the record → outbox
 *     is cleared.
 *  6. pullSince() — mocked GET /api/v1/sync/pull returns the same blob →
 *     engine decrypts it and writes to Dexie transactions table; cursor advances.
 *
 * Assertions:
 *  - pendingUploads is empty after flushOutbox
 *  - pullSince returns records.length === 1
 *  - syncCursors row exists with a non-empty cursor
 *  - useSyncStore.lastError is null after both operations
 */

import { test, expect } from "@playwright/test";
import { setup } from "./helpers";

const FAMILY_ID = "00000000-0000-7000-8000-000000000099";
const RECORD_ID = "00000000-0000-7000-8000-000000000042";
const USER_ID = "00000000-0000-7000-8000-000000000001";
const NEXT_CURSOR = "dGVzdEN1cnNvcjE"; // base64url "testCursor1"

test("sync: push/pull single-device round-trip", async ({ page }) => {
  // ── 1. Seed onboarding + navigate ────────────────────────────────────────────
  await setup(page);

  // ── 2. Route all sync HTTP calls before any JS runs them ─────────────────────
  // We store the captured blob here so the pull mock can serve it back.
  let capturedBlob: string | null = null;

  await page.route("**/api/v1/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      records: Array<{ recordId: string; blob: string }>;
    };
    // Capture the encrypted blob from the first record for use in the pull mock.
    if (body.records.length > 0) {
      capturedBlob = body.records[0].blob;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accepted: [{ recordId: RECORD_ID, version: 1, familySeq: 1 }],
        conflicts: [],
      }),
    });
  });

  await page.route("**/api/v1/sync/pull*", async (route) => {
    // Return the same encrypted blob that was pushed, so decrypt succeeds.
    const blob = capturedBlob ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        records:
          blob.length > 0
            ? [
                {
                  recordId: RECORD_ID,
                  recordType: "transaction",
                  blob,
                  version: 1,
                  familySeq: 1,
                  updatedAtMap: { [USER_ID]: new Date().toISOString() },
                  deletedAt: null,
                  addedByUser: USER_ID,
                  editedByUser: USER_ID,
                },
              ]
            : [],
        nextCursor: NEXT_CURSOR,
        hasMore: false,
      }),
    });
  });

  // ── 3. Initialise crypto: generate device key + seed familyKey ────────────────
  // Generate a real device keypair so the worker is fully warmed up.
  await page.evaluate(async () => {
    const { cryptoWorker } = await import("/src/services/crypto/worker-client.ts");
    await cryptoWorker.generateAndPersistDeviceKey();
  });

  // Seed a 32-byte familyKey directly into the worker's IndexedDB so that
  // encryptRecordWithStoredKey / decryptRecordWithStoredKey work without
  // going through the full wrapAndPersistFamilyKey ceremony.
  // The worker reads from DB_NAME="expenses-app-db", STORE_NAME="cipherKeys".
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("expenses-app-db");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("cipherKeys", "readwrite");
        const store = tx.objectStore("cipherKeys");
        // A deterministic 32-byte key — fine for test purposes.
        const familyKey = new Uint8Array(32).fill(0xab);
        store.put({ name: "familyKey", value: familyKey, createdAt: new Date().toISOString() });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // ── 4. enqueuePush ────────────────────────────────────────────────────────────
  // Calls encryptRecordWithStoredKey (uses the familyKey we just seeded), then
  // stores the envelope in pendingUploads, then fires flushOutbox().
  // We call it directly from inside the page so the engine module is the live
  // singleton (same worker, same Dexie instance).
  await page.evaluate(
    async ({ recordId, familyId, userId }) => {
      const { enqueuePush } = await import("/src/services/sync/engine.ts");
      await enqueuePush({
        recordId,
        recordType: "transaction",
        familyId,
        addedByUserId: userId,
        editedByUserId: userId,
        updatedAtMap: { [userId]: new Date().toISOString() },
        parentVersion: 0,
        payload: { amount: 1234, note: "test", currency: "USD" },
      });
    },
    { recordId: RECORD_ID, familyId: FAMILY_ID, userId: USER_ID },
  );

  // Give flushOutbox (fired inside enqueuePush as fire-and-forget) time to settle.
  await page.waitForTimeout(2000);

  // ── 5. Assert: outbox is empty after flush ────────────────────────────────────
  const outboxCount = await page.evaluate(async () => {
    const { db } = await import("/src/db/database.ts");
    return db.pendingUploads.count();
  });
  expect(outboxCount, "pendingUploads should be empty after flush").toBe(0);

  // Also assert that capturedBlob was populated (i.e., push was actually called).
  expect(capturedBlob, "push mock must have been called with a blob").not.toBeNull();

  // ── 6. pullSince ──────────────────────────────────────────────────────────────
  const pullResult = await page.evaluate(
    async ({ familyId, cursor }) => {
      const { pullSince } = await import("/src/services/sync/engine.ts");
      const result = await pullSince(familyId, cursor);
      return {
        recordCount: result.records.length,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    },
    { familyId: FAMILY_ID, cursor: undefined },
  );

  expect(pullResult.recordCount, "pull must return 1 record").toBe(1);
  expect(pullResult.nextCursor, "pull must return a non-empty cursor").toBe(NEXT_CURSOR);
  expect(pullResult.hasMore).toBe(false);

  // ── 7. Assert: cursor was persisted ──────────────────────────────────────────
  const storedCursor = await page.evaluate(
    async ({ familyId }) => {
      const { getCursor } = await import("/src/services/sync/engine.ts");
      return getCursor(familyId);
    },
    { familyId: FAMILY_ID },
  );
  expect(storedCursor, "cursor must be persisted after pull").toBe(NEXT_CURSOR);

  // ── 8. Assert: sync store has no error ───────────────────────────────────────
  const syncError = await page.evaluate(async () => {
    const { useSyncStore } = await import("/src/stores/sync-store.ts");
    return useSyncStore.getState().lastError;
  });
  expect(syncError, "sync store must have no error").toBeNull();
});
