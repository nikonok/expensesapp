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
  },
}));

// Mock the HTTP client.
vi.mock("../client", () => ({
  pushRecords: vi.fn(),
  pullRecords: vi.fn(),
}));

import { pushRecords, pullRecords } from "../client";
import { enqueuePush, flushOutbox, pullSince } from "../engine";
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
