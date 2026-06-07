// @vitest-environment node

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/database";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock log.service to keep test output clean.
vi.mock("@/services/log.service", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock sync-store so the engine can call setIsSyncing etc without a DOM.
vi.mock("@/stores/sync-store", () => ({
  useSyncStore: {
    getState: () => ({
      setIsSyncing: vi.fn(),
      setLastSyncAt: vi.fn(),
      setLastError: vi.fn(),
    }),
  },
}));

// Mock the crypto worker-client — key material is not available in node tests.
const mockEncryptResult = {
  blob: new Uint8Array([1, 2, 3, 4]),
  nonce: new Uint8Array(24),
  plaintextByteCount: 12,
};

const mockDecryptResult = new TextEncoder().encode(JSON.stringify({ amount: 100 }));

vi.mock("@/services/crypto/worker-client", () => ({
  cryptoWorker: {
    encryptRecordWithStoredKey: vi.fn(async () => mockEncryptResult),
    decryptRecordWithStoredKey: vi.fn(async () => mockDecryptResult),
    unwrapAndPersistFamilyKey: vi.fn(async () => undefined),
    wrapStoredFamilyKeyForDevice: vi.fn(async () => "wrapped-envelope-b64u"),
    fingerprintPublicKey: vi.fn(async () => "ABCDEFGHJKLMN"),
    clearAllStoredKeys: vi.fn(async () => undefined),
  },
}));

// Mock the HTTP client.
vi.mock("../client", () => ({
  pushRecords: vi.fn(),
  pullRecords: vi.fn(),
}));

// Mock apiFetch for silentlyApproveDevice.
vi.mock("@/services/auth/client", () => ({
  apiFetch: vi.fn(async () => ({ pubKey: "fallback-pubkey-b64u" })),
}));

// Mock the SSE module — we control the onEvent callback directly in tests.
let capturedSSEOpts: Parameters<typeof import("../sse").connectSSE>[0] | null = null;
vi.mock("../sse", () => ({
  connectSSE: vi.fn((opts) => {
    capturedSSEOpts = opts;
    return { disconnect: vi.fn() };
  }),
}));

// Mock device-join store.
const mockSetPendingDeviceJoin = vi.fn();
vi.mock("@/stores/device-join-store", () => ({
  useDeviceJoinStore: {
    getState: () => ({ setPendingDeviceJoin: mockSetPendingDeviceJoin }),
  },
}));

// Mock auth session store for you.removed and device.activated tests.
const mockSignOut = vi.fn(async () => {});
const mockClearAwaitingEnvelope = vi.fn();
vi.mock("@/services/auth/session", () => ({
  useAuthStore: {
    getState: () => ({ signOut: mockSignOut, clearAwaitingEnvelope: mockClearAwaitingEnvelope }),
  },
}));

import { pushRecords, pullRecords } from "../client";
import {
  enqueuePush,
  flushOutbox,
  pullSince,
  startLiveSync,
  writeDecryptedRecord,
} from "../engine";
import { getCursor, encodeCursor } from "../cursor";
import type { RawRecord } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRawRecord(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000001",
    recordType: "transaction",
    familyId: "ffffffff-0000-7000-8000-000000000001",
    addedByUserId: "user-001",
    editedByUserId: "user-001",
    updatedAtMap: { amount: "2024-01-01T00:00:00.000Z" },
    parentVersion: 0,
    payload: { amount: 100 },
    ...overrides,
  };
}

// ── beforeEach: reset DB state and mock call history ─────────────────────────

beforeEach(async () => {
  await db.pendingUploads.clear();
  await db.syncCursors.clear();
  await db.transactions.clear();
  vi.clearAllMocks();
  // Reset flushInProgress between tests by ensuring no in-progress flush.
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("enqueuePush", () => {
  it("stores encrypted envelope in pendingUploads outbox", async () => {
    // Stub online status — don't want to trigger a real flush.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord();
    await enqueuePush(record);

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].recordId).toBe(record.recordId);
    expect(rows[0].recordType).toBe("transaction");
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].lastFailedAt).toBeNull();
  });

  it("persists addedByUserId and editedByUserId on the pendingUploads row", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord({
      addedByUserId: "user-aaa",
      editedByUserId: "user-bbb",
    });
    await enqueuePush(record);

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].addedByUserId).toBe("user-aaa");
    expect(rows[0].editedByUserId).toBe("user-bbb");
  });

  it("triggers flushOutbox immediately when online (accepted path)", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [{ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000001", version: 1, familySeq: 1 }],
      conflicts: [],
    });

    const record = makeRawRecord();
    await enqueuePush(record);

    // Allow the microtask fire-and-forget flush to complete.
    await new Promise((r) => setTimeout(r, 10));

    expect(pushRecords).toHaveBeenCalledTimes(1);
    // After accepted flush, outbox should be empty.
    const remaining = await db.pendingUploads.toArray();
    expect(remaining).toHaveLength(0);
  });
});

describe("flushOutbox — accepted path", () => {
  it("sends batch and deletes accepted records from outbox", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord();
    await enqueuePush(record);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [{ recordId: record.recordId, version: 1, familySeq: 1 }],
      conflicts: [],
    });

    await flushOutbox();

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(0);
    expect(pushRecords).toHaveBeenCalledTimes(1);
  });

  it("sends correct payload shape to pushRecords", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord({ parentVersion: 3 });
    await enqueuePush(record);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [{ recordId: record.recordId, version: 4, familySeq: 10 }],
      conflicts: [],
    });

    await flushOutbox();

    const call = vi.mocked(pushRecords).mock.calls[0][0];
    expect(call.records).toHaveLength(1);
    expect(call.records[0].recordId).toBe(record.recordId);
    expect(call.records[0].parentVersion).toBe(3);
  });

  it("advances pull cursor to encoding of max familySeq among accepted", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const familyId = "ffffffff-0000-7000-8000-000000000001";

    // Enqueue 3 records (all share the same familyId via makeRawRecord default).
    const r1 = makeRawRecord({ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000010" });
    const r2 = makeRawRecord({ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000011" });
    const r3 = makeRawRecord({ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000012" });
    await enqueuePush(r1);
    await enqueuePush(r2);
    await enqueuePush(r3);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [
        { recordId: r1.recordId, version: 1, familySeq: 10 },
        { recordId: r2.recordId, version: 1, familySeq: 11 },
        { recordId: r3.recordId, version: 1, familySeq: 12 },
      ],
      conflicts: [],
    });

    await flushOutbox();

    // Cursor must be set to encoding of 12 (the max familySeq).
    const savedCursor = await getCursor(familyId);
    expect(savedCursor).toBe(encodeCursor(12));
  });
});

describe("flushOutbox — network error path", () => {
  it("increments attempts and marks lastFailedAt on network error", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord();
    await enqueuePush(record);

    vi.mocked(pushRecords).mockRejectedValueOnce(new Error("Network error"));

    await flushOutbox();

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastFailedAt).not.toBeNull();
  });
});

describe("flushOutbox — conflict + merge → re-push", () => {
  it("decrypts both blobs, merges, re-enqueues with updated parentVersion", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const recordId = "conflict-record-id-001";
    const record = makeRawRecord({ recordId });
    await enqueuePush(record);

    // First push returns a conflict.
    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [],
      conflicts: [
        {
          recordId,
          currentBlob: "AAAA",
          currentVersion: 5,
          currentUpdatedAtMap: { amount: "2024-06-01T00:00:00.000Z" },
        },
      ],
    });

    await flushOutbox();

    // The conflicted item should have been removed and a new merged one added.
    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].parentVersion).toBe(5);
    expect(rows[0].recordId).toBe(recordId);
    // decryptRecordWithStoredKey should have been called for both local + server blobs.
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.decryptRecordWithStoredKey)).toHaveBeenCalledTimes(2);
  });
});

describe("pullSince", () => {
  it("decrypts pulled records and writes them to the correct Dexie table", async () => {
    const familyId = "family-pull-test";
    const txPayload = {
      id: 1,
      type: "EXPENSE",
      date: "2024-01-01",
      timestamp: "2024-01-01T12:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 500,
      amountMainCurrency: 500,
      exchangeRate: 1,
      note: "",
      isTrashed: false,
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2024-01-01T12:00:00.000Z",
      updatedAt: "2024-01-01T12:00:00.000Z",
    };

    // Return tx payload when decryptRecordWithStoredKey is called.
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    vi.mocked(cryptoWorker.decryptRecordWithStoredKey).mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(txPayload)),
    );

    vi.mocked(pullRecords).mockResolvedValueOnce({
      records: [
        {
          recordId: "tx-001",
          recordType: "transaction",
          blob: "AAAA",
          version: 1,
          familySeq: 1,
          updatedAtMap: { amount: "2024-01-01T00:00:00.000Z" },
          deletedAt: null,
          addedByUser: "user-001",
          editedByUser: "user-001",
        },
      ],
      nextCursor: "cursor-v1",
      hasMore: false,
    });

    const result = await pullSince(familyId, undefined);

    expect(result.nextCursor).toBe("cursor-v1");
    expect(result.hasMore).toBe(false);

    // Cursor should be persisted.
    const { getCursor } = await import("../cursor");
    const savedCursor = await getCursor(familyId);
    expect(savedCursor).toBe("cursor-v1");
  });

  it("skips records that fail decryption without throwing", async () => {
    const familyId = "family-bad-decrypt";

    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    vi.mocked(cryptoWorker.decryptRecordWithStoredKey).mockRejectedValueOnce(
      new Error("commit tag mismatch"),
    );

    vi.mocked(pullRecords).mockResolvedValueOnce({
      records: [
        {
          recordId: "bad-record",
          recordType: "transaction",
          blob: "CORRUPT",
          version: 1,
          familySeq: 1,
          updatedAtMap: {},
          deletedAt: null,
          addedByUser: "user-001",
          editedByUser: "user-001",
        },
      ],
      nextCursor: "cursor-after-bad",
      hasMore: false,
    });

    // Should not throw.
    await expect(pullSince(familyId, undefined)).resolves.toBeDefined();
  });
});

// ── startLiveSync ─────────────────────────────────────────────────────────────

describe("startLiveSync — record.changed triggers debounced pull", () => {
  it("calls pullSince after record.changed event (debounced)", async () => {
    vi.useFakeTimers();

    vi.mocked(pullRecords).mockResolvedValue({
      records: [],
      nextCursor: "cursor-live-1",
      hasMore: false,
    });

    const disconnect = startLiveSync("family-live-001");
    expect(capturedSSEOpts).not.toBeNull();

    // Simulate multiple rapid record.changed events.
    capturedSSEOpts!.onEvent("record.changed", {
      seq: 1,
      recordId: "r1",
      recordType: "transaction",
      version: 1,
    });
    capturedSSEOpts!.onEvent("record.changed", {
      seq: 2,
      recordId: "r2",
      recordType: "transaction",
      version: 1,
    });

    // pullRecords should not be called yet — still in debounce window.
    expect(pullRecords).not.toHaveBeenCalled();

    // Advance past debounce.
    await vi.runAllTimersAsync();

    expect(pullRecords).toHaveBeenCalledTimes(1);
    disconnect();
    vi.useRealTimers();
  });

  it("trailing-edge debounce: burst of 5 events within 200ms produces exactly one pull", async () => {
    vi.useFakeTimers();

    vi.mocked(pullRecords).mockResolvedValue({
      records: [],
      nextCursor: "cursor-trailing-1",
      hasMore: false,
    });

    const disconnect = startLiveSync("family-trailing-001");
    expect(capturedSSEOpts).not.toBeNull();

    // Prime: fire one event and let the initial pull complete so that lastPullAt
    // is set to "now". This puts us in the normal steady-state where the debounce
    // window is fully active for subsequent events.
    capturedSSEOpts!.onEvent("record.changed", {
      seq: 0,
      recordId: "r0",
      recordType: "transaction",
      version: 1,
    });
    await vi.runAllTimersAsync();
    expect(pullRecords).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    // Burst: 5 events within 200ms, all within the 500ms debounce window.
    // Each new event clears the pending timer and reschedules (trailing-edge).
    for (let i = 1; i <= 5; i++) {
      capturedSSEOpts!.onEvent("record.changed", {
        seq: i,
        recordId: `r${i}`,
        recordType: "transaction",
        version: 1,
      });
      // Advance 40ms between events (5 × 40ms = 200ms total burst duration).
      await vi.advanceTimersByTimeAsync(40);
    }

    // Still within the debounce window after the burst — no pull yet.
    expect(pullRecords).not.toHaveBeenCalled();

    // Advance past the debounce window so the trailing-edge timer fires.
    await vi.advanceTimersByTimeAsync(500);

    // Exactly one pull after the burst settled.
    expect(pullRecords).toHaveBeenCalledTimes(1);

    disconnect();
    vi.useRealTimers();
  });
});

describe("startLiveSync — device.joined updates the store", () => {
  it("dispatches setPendingDeviceJoin with a fingerprint and never auto-approves (B5a)", async () => {
    vi.useFakeTimers();

    const disconnect = startLiveSync("family-live-002");

    capturedSSEOpts!.onEvent("device.joined", {
      deviceId: "dev-new-001",
      label: "Android (2026-05-23)",
      createdAt: "2026-05-23T10:00:00Z",
      pubKey: "test-pub-key-b64u",
    });

    // Let the dynamic import microtask run.
    await vi.runAllTimersAsync();

    expect(mockSetPendingDeviceJoin).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "dev-new-001",
        pubKey: "test-pub-key-b64u",
        fingerprint: "ABCDEFGHJKLMN",
      }),
    );

    // B5a: silentlyApproveDevice was removed. There must be no
    // wrapStoredFamilyKeyForDevice call until the user explicitly approves
    // via the banner.
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.wrapStoredFamilyKeyForDevice)).not.toHaveBeenCalled();

    disconnect();
    vi.useRealTimers();
  });
});

// ── B8 — 413 quota-exceeded path ─────────────────────────────────────────────

describe("flushOutbox — 413 quota terminal (B8)", () => {
  it("marks every record in the batch terminal and sets lastError=quota-exceeded", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord({ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-0000000004a1" });
    await enqueuePush(record);

    interface QuotaErr extends Error {
      status: number;
    }
    const quotaErr = new Error("payload too large") as QuotaErr;
    quotaErr.status = 413;
    vi.mocked(pushRecords).mockRejectedValueOnce(quotaErr);

    await flushOutbox();

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].terminal).toBe(true);

    // A subsequent flush with NO new mock must not call pushRecords again
    // (terminal rows are skipped).
    vi.mocked(pushRecords).mockClear();
    await flushOutbox();
    expect(pushRecords).not.toHaveBeenCalled();
  });
});

// ── B8 — empty currentBlob (invalid-parentVersion) conflict path ─────────────

describe("flushOutbox — invalid-parentVersion conflict (B8)", () => {
  it("re-enqueues with parentVersion=0 without decrypting an empty currentBlob", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const recordId = "aaaaaaaa-bbbb-7ccc-8ddd-0000000004b1";
    await enqueuePush(makeRawRecord({ recordId, parentVersion: 7 }));

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [],
      conflicts: [
        {
          recordId,
          currentBlob: "",
          currentVersion: 0,
          currentUpdatedAtMap: {},
        },
      ],
    });

    await flushOutbox();

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].parentVersion).toBe(0);
    expect(rows[0].recordId).toBe(recordId);

    // Crucially: NO decrypt was attempted for the empty currentBlob.
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.decryptRecordWithStoredKey)).not.toHaveBeenCalled();
    expect(vi.mocked(cryptoWorker.encryptRecordWithStoredKey)).toHaveBeenCalledTimes(1);
    //                                                          ^ only the initial enqueue
  });
});

// ── B8 — tombstone propagation on pull ───────────────────────────────────────

describe("writeDecryptedRecord — tombstone propagation (B8)", () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.accounts.clear();
    await db.categories.clear();
    await db.budgets.clear();
    await db.settings.clear();
  });

  it("hard-deletes a transaction when meta.deletedAt is non-null", async () => {
    await db.transactions.add({
      id: 42,
      type: "EXPENSE",
      date: "2024-01-01",
      timestamp: "2024-01-01T00:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 100,
      amountMainCurrency: 100,
      exchangeRate: 1,
      note: "",
      isTrashed: false,
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    } as Parameters<typeof db.transactions.put>[0]);

    await writeDecryptedRecord(
      "transaction",
      { id: 42 },
      { recordId: "tx-42", deletedAt: "2024-02-01T00:00:00.000Z" },
    );

    const remaining = await db.transactions.get(42);
    expect(remaining).toBeUndefined();
  });

  it("soft-deletes an account (sets isTrashed=true) when meta.deletedAt is set", async () => {
    await db.accounts.add({
      id: 7,
      name: "Old account",
      type: "REGULAR",
      currency: "USD",
      balance: 0,
      startingBalance: 0,
      description: "",
      icon: "wallet",
      color: "oklch(70% 0.2 200)",
      isTrashed: false,
      includeInTotal: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    } as Parameters<typeof db.accounts.put>[0]);

    await writeDecryptedRecord(
      "account",
      { id: 7 },
      { recordId: "acc-7", deletedAt: "2024-02-01T00:00:00.000Z" },
    );

    const row = await db.accounts.get(7);
    expect(row).toBeDefined();
    expect(row?.isTrashed).toBe(true);
  });

  it("soft-deletes a category (sets isTrashed=true) when meta.deletedAt is set", async () => {
    await db.categories.add({
      id: 3,
      name: "Old cat",
      type: "EXPENSE",
      icon: "tag",
      color: "oklch(70% 0.2 200)",
      displayOrder: 0,
      isTrashed: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    } as Parameters<typeof db.categories.put>[0]);

    await writeDecryptedRecord(
      "category",
      { id: 3 },
      { recordId: "cat-3", deletedAt: "2024-02-01T00:00:00.000Z" },
    );

    const row = await db.categories.get(3);
    expect(row).toBeDefined();
    expect(row?.isTrashed).toBe(true);
  });

  it("performs an upsert (no delete) when meta.deletedAt is empty/absent", async () => {
    const txPayload = {
      id: 9,
      type: "EXPENSE",
      date: "2024-01-01",
      timestamp: "2024-01-01T00:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 250,
      amountMainCurrency: 250,
      exchangeRate: 1,
      note: "",
      isTrashed: false,
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    await writeDecryptedRecord("transaction", txPayload, { recordId: "tx-9", deletedAt: null });

    const row = await db.transactions.get(9);
    expect(row?.amount).toBe(250);
  });
});

describe("startLiveSync — device.activated calls unwrapAndPersistFamilyKey then pulls", () => {
  it("unwraps key and triggers pull", async () => {
    vi.useFakeTimers();

    vi.mocked(pullRecords).mockResolvedValue({
      records: [],
      nextCursor: "cursor-activated",
      hasMore: false,
    });

    const disconnect = startLiveSync("family-live-003");

    capturedSSEOpts!.onEvent("device.activated", {
      deviceId: "dev-003",
      envelope: "sealed-envelope-b64u",
    });

    await vi.runAllTimersAsync();

    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.unwrapAndPersistFamilyKey)).toHaveBeenCalledWith(
      "sealed-envelope-b64u",
    );
    expect(mockClearAwaitingEnvelope).toHaveBeenCalledTimes(1);
    expect(pullRecords).toHaveBeenCalledTimes(1);

    disconnect();
    vi.useRealTimers();
  });
});
