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

// Mock auth session store for you.removed, device.activated, and
// device.revoked tests. `mockDevice` is mutable per-test (reset in the outer
// beforeEach) so device.revoked's "is this device?" comparison is testable.
const mockSignOut = vi.fn(async () => {});
const mockClearAwaitingEnvelope = vi.fn();
let mockDevice: { id: string } | null = null;
vi.mock("@/services/auth/session", () => ({
  useAuthStore: {
    getState: () => ({
      signOut: mockSignOut,
      clearAwaitingEnvelope: mockClearAwaitingEnvelope,
      device: mockDevice,
    }),
  },
}));

import { pushRecords, pullRecords } from "../client";
import {
  enqueuePush,
  flushOutbox,
  pullSince,
  retryTerminalUploads,
  startLiveSync,
  writeDecryptedRecord,
} from "../engine";
import { getCursor, setCursor, encodeCursor } from "../cursor";
import { getMappingByLocalId, getMappingByUuid, upsertMappingFromPull } from "../record-mapping";
import type { RawRecord } from "../types";

function makeAccount(overrides: Partial<import("@/db/models").Account> = {}) {
  const now = "2024-01-01T00:00:00.000Z";
  return {
    name: "Checking",
    type: "REGULAR" as const,
    color: "oklch(70% 0.2 200)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 1000,
    startingBalance: 1000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTxPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

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
  await db.recordMappings.clear();
  await db.transactions.clear();
  vi.clearAllMocks();
  mockDevice = null;
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

  it("advances pull cursor to encoding of max familySeq when accepted seqs are contiguous with the cursor", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const familyId = "ffffffff-0000-7000-8000-000000000001";
    // Cursor already at seq 9 — the accepted run [10,11,12] picks up right
    // where it left off, so the fast-forward is safe.
    await setCursor(familyId, encodeCursor(9));

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

    const savedCursor = await getCursor(familyId);
    expect(savedCursor).toBe(encodeCursor(12));
  });

  it("does NOT advance the cursor when accepted seqs have a gap after the current cursor", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const familyId = "ffffffff-0000-7000-8000-000000000001";
    // Cursor is at 0 (never pulled), but the accepted seqs start at 10 — seqs
    // 1-9 belong to records this client hasn't pulled yet (e.g. another
    // device's writes). Fast-forwarding to 12 would skip them forever.
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

    const savedCursor = await getCursor(familyId);
    expect(savedCursor).toBeUndefined();
  });

  it("persists each accepted record's server version into the record mapping (parentVersion bookkeeping)", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const { getOrCreateMappingForPush } = await import("../record-mapping");
    const mapping = await getOrCreateMappingForPush("transaction", "55", "user-001");

    const record = makeRawRecord({ recordId: mapping.uuid, parentVersion: 0 });
    await enqueuePush(record);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [{ recordId: mapping.uuid, version: 7, familySeq: 1 }],
      conflicts: [],
    });

    await flushOutbox();

    const updated = await getMappingByLocalId("transaction", "55");
    expect(updated?.lastServerVersion).toBe(7);

    // A subsequent push for the same local row must carry parentVersion=7.
    const { getOrCreateMappingForPush: refetch } = await import("../record-mapping");
    const refreshed = await refetch("transaction", "55", "user-001");
    expect(refreshed.lastServerVersion).toBe(7);
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

  it("uses the conflict response's own currentAddedByUser/currentEditedByUser for the server-side AAD meta, not the local outbox row's", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const recordId = "conflict-record-id-002";
    const record = makeRawRecord({
      recordId,
      addedByUserId: "local-creator",
      editedByUserId: "local-editor",
    });
    await enqueuePush(record);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [],
      conflicts: [
        {
          recordId,
          currentBlob: "AAAA",
          currentVersion: 5,
          currentUpdatedAtMap: { amount: "2024-06-01T00:00:00.000Z" },
          currentAddedByUser: "server-creator",
          currentEditedByUser: "server-editor",
        },
      ],
    });

    await flushOutbox();

    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    const calls = vi.mocked(cryptoWorker.decryptRecordWithStoredKey).mock.calls;
    expect(calls).toHaveLength(2);
    // Second call decrypts the server blob — its meta must carry the
    // conflict response's own editor ids, never the local outbox row's.
    const serverMetaArg = calls[1][1] as { addedByUserId: string; editedByUserId: string };
    expect(serverMetaArg.addedByUserId).toBe("server-creator");
    expect(serverMetaArg.editedByUserId).toBe("server-editor");
  });

  it("leaves a quota-reason conflict queued as-is (no merge, no deletion, no attempts bump)", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const recordId = "conflict-record-id-quota";
    const record = makeRawRecord({ recordId });
    await enqueuePush(record);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [],
      conflicts: [
        {
          recordId,
          currentBlob: "",
          currentVersion: 0,
          currentUpdatedAtMap: {},
          reason: "quota",
        },
      ],
    });

    await flushOutbox();

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].recordId).toBe(recordId);
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].terminal).not.toBe(true);

    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.decryptRecordWithStoredKey)).not.toHaveBeenCalled();
  });

  it("applies the server tombstone locally by identity (no decrypt) and drops the local edit when the server side was deleted", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    await db.transactions.add({
      id: 88,
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

    const recordId = "conflict-record-id-tombstone";
    await upsertMappingFromPull("transaction", "88", recordId, "user-001", 3);

    const record = makeRawRecord({ recordId });
    await enqueuePush(record);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [],
      conflicts: [
        {
          recordId,
          currentBlob: "AAAA",
          currentVersion: 4,
          currentUpdatedAtMap: {},
          currentDeletedAt: "2024-07-01T00:00:00.000Z",
          reason: "version",
        },
      ],
    });

    await flushOutbox();

    // Local row must be gone (server delete wins) — no decrypt attempted.
    expect(await db.transactions.get(88)).toBeUndefined();
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.decryptRecordWithStoredKey)).not.toHaveBeenCalled();

    // Outbox row is gone — the local edit was dropped, not requeued.
    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(0);

    // Mapping's lastServerVersion is refreshed to the server's tombstone version.
    const mapping = await getMappingByLocalId("transaction", "88");
    expect(mapping?.lastServerVersion).toBe(4);
  });

  it("drops a local delete without decrypting when the server side is already a tombstone too", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const recordId = "conflict-record-id-both-deleted";

    await enqueuePush(
      makeRawRecord({
        recordId,
        deletedAt: "2024-07-01T00:00:00.000Z",
      }),
    );

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [],
      conflicts: [
        {
          recordId,
          currentBlob: "AAAA",
          currentVersion: 4,
          currentUpdatedAtMap: {},
          currentDeletedAt: "2024-07-01T00:00:00.000Z",
          reason: "version",
        },
      ],
    });

    await flushOutbox();

    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.decryptRecordWithStoredKey)).not.toHaveBeenCalled();
    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(0);
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

  it("does not advance the cursor past a record that failed to decrypt, even when later records in the same page would succeed", async () => {
    const familyId = "family-partial-failure";

    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    // First record decrypts fine, second fails — the third must never even
    // be attempted (processing stops at the first failure).
    vi.mocked(cryptoWorker.decryptRecordWithStoredKey)
      .mockResolvedValueOnce(
        new TextEncoder().encode(JSON.stringify({ key: "mainCurrency", value: "USD" })),
      )
      .mockRejectedValueOnce(new Error("commit tag mismatch"));

    vi.mocked(pullRecords).mockResolvedValueOnce({
      records: [
        {
          recordId: "setting-good-1",
          recordType: "settings",
          blob: "AAAA",
          version: 1,
          familySeq: 5,
          updatedAtMap: {},
          deletedAt: null,
          addedByUser: "user-001",
          editedByUser: "user-001",
        },
        {
          recordId: "setting-bad-2",
          recordType: "settings",
          blob: "CORRUPT",
          version: 1,
          familySeq: 6,
          updatedAtMap: {},
          deletedAt: null,
          addedByUser: "user-001",
          editedByUser: "user-001",
        },
        {
          recordId: "setting-unreached-3",
          recordType: "settings",
          blob: "AAAA",
          version: 1,
          familySeq: 7,
          updatedAtMap: {},
          deletedAt: null,
          addedByUser: "user-001",
          editedByUser: "user-001",
        },
      ],
      nextCursor: encodeCursor(7),
      hasMore: false,
    });

    await pullSince(familyId, undefined);

    // Cursor must sit at seq 5 (the last SUCCESSFULLY applied record) —
    // never at the server's own nextCursor (seq 7), which would skip the
    // failed record #2 (and unreached #3) forever.
    const savedCursor = await getCursor(familyId);
    expect(savedCursor).toBe(encodeCursor(5));

    // The third record must never have been decrypted — processing stopped
    // at the first failure.
    expect(vi.mocked(cryptoWorker.decryptRecordWithStoredKey)).toHaveBeenCalledTimes(2);
  });

  it("loops on hasMore until a page reports hasMore=false, applying every page's records", async () => {
    const familyId = "family-hasmore-loop";

    // Two distinct settings keys across the two pages — in real traffic the
    // SAME settings key would always carry the SAME wire recordId (it's
    // resolved from the one stable mapping row), so two different recordIds
    // sharing a key never legitimately happens; use different keys here so
    // the test exercises pagination without also exercising that invariant.
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    vi.mocked(cryptoWorker.decryptRecordWithStoredKey)
      .mockResolvedValueOnce(
        new TextEncoder().encode(JSON.stringify({ key: "mainCurrency", value: "EUR" })),
      )
      .mockResolvedValueOnce(
        new TextEncoder().encode(JSON.stringify({ key: "language", value: "en" })),
      );

    vi.mocked(pullRecords)
      .mockResolvedValueOnce({
        records: [
          {
            recordId: "page1-rec",
            recordType: "settings",
            blob: "AAAA",
            version: 1,
            familySeq: 1,
            updatedAtMap: {},
            deletedAt: null,
            addedByUser: "user-001",
            editedByUser: "user-001",
          },
        ],
        nextCursor: encodeCursor(1),
        hasMore: true,
      })
      .mockResolvedValueOnce({
        records: [
          {
            recordId: "page2-rec",
            recordType: "settings",
            blob: "AAAA",
            version: 1,
            familySeq: 2,
            updatedAtMap: {},
            deletedAt: null,
            addedByUser: "user-001",
            editedByUser: "user-001",
          },
        ],
        nextCursor: encodeCursor(2),
        hasMore: false,
      });

    const result = await pullSince(familyId, undefined);

    // Both pages were fetched.
    expect(pullRecords).toHaveBeenCalledTimes(2);
    // The second call's `since` must be the first page's own nextCursor.
    expect(vi.mocked(pullRecords).mock.calls[1][0]).toEqual({ since: encodeCursor(1) });
    // Final cursor reflects the LAST page.
    const savedCursor = await getCursor(familyId);
    expect(savedCursor).toBe(encodeCursor(2));
    // The function returns the last-fetched page's response.
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBe(encodeCursor(2));
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

describe("writeDecryptedRecord — mapping-aware identity + tombstone propagation (B8)", () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.accounts.clear();
    await db.categories.clear();
    await db.budgets.clear();
    await db.settings.clear();
    await db.recordMappings.clear();
  });

  it("hard-deletes a transaction when meta.deletedAt is non-null, resolved via the mapping (not payload.id)", async () => {
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
    await upsertMappingFromPull("transaction", "42", "tx-42", "user-001", 1);

    await writeDecryptedRecord(
      "transaction",
      { id: 42 },
      {
        recordId: "tx-42",
        deletedAt: "2024-02-01T00:00:00.000Z",
        addedByUser: "user-001",
        version: 2,
      },
    );

    const remaining = await db.transactions.get(42);
    expect(remaining).toBeUndefined();
  });

  it("tombstone is a no-op when this device never had a local copy of the record (no mapping)", async () => {
    // Nothing seeded, no mapping — a tombstone for a record we never pulled
    // (created and deleted entirely on another device) must not crash or
    // touch unrelated rows.
    await expect(
      writeDecryptedRecord(
        "transaction",
        { id: 999 },
        {
          recordId: "tx-never-seen",
          deletedAt: "2024-02-01T00:00:00.000Z",
          addedByUser: "u",
          version: 1,
        },
      ),
    ).resolves.toBeUndefined();
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
    await upsertMappingFromPull("account", "7", "acc-7", "user-001", 1);

    await writeDecryptedRecord(
      "account",
      { id: 7 },
      {
        recordId: "acc-7",
        deletedAt: "2024-02-01T00:00:00.000Z",
        addedByUser: "user-001",
        version: 2,
      },
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
    await upsertMappingFromPull("category", "3", "cat-3", "user-001", 1);

    await writeDecryptedRecord(
      "category",
      { id: 3 },
      {
        recordId: "cat-3",
        deletedAt: "2024-02-01T00:00:00.000Z",
        addedByUser: "user-001",
        version: 2,
      },
    );

    const row = await db.categories.get(3);
    expect(row).toBeDefined();
    expect(row?.isTrashed).toBe(true);
  });

  it("upserts an EXISTING mapped record in place (overwrites id with the mapped localId, not payload.id)", async () => {
    await db.transactions.add({
      id: 9,
      type: "EXPENSE",
      date: "2024-01-01",
      timestamp: "2024-01-01T00:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 1,
      amountMainCurrency: 1,
      exchangeRate: 1,
      note: "",
      isTrashed: false,
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    } as Parameters<typeof db.transactions.put>[0]);
    await upsertMappingFromPull("transaction", "9", "tx-9", "user-001", 1);

    const txPayload = {
      // Foreign device's embedded id — must be IGNORED in favour of the
      // mapping's localId (9 here, but the point is it's never trusted).
      id: 12345,
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
    await writeDecryptedRecord("transaction", txPayload, {
      recordId: "tx-9",
      deletedAt: null,
      addedByUser: "user-001",
      version: 2,
    });

    const row = await db.transactions.get(9);
    expect(row?.amount).toBe(250);
    expect(await db.transactions.get(12345)).toBeUndefined();

    const mapping = await getMappingByUuid("tx-9");
    expect(mapping?.localId).toBe("9");
    expect(mapping?.lastServerVersion).toBe(2);
  });

  it("creates a fresh local row + mapping for a record never seen before (never trusts payload.id)", async () => {
    const txPayload = {
      id: 9999, // some OTHER device's local id — must not be used here
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
    await writeDecryptedRecord("transaction", txPayload, {
      recordId: "tx-brand-new",
      deletedAt: null,
      addedByUser: "user-remote",
      version: 1,
    });

    const mapping = await getMappingByUuid("tx-brand-new");
    expect(mapping).toBeDefined();
    expect(mapping?.creatorUserId).toBe("user-remote");
    expect(mapping?.lastServerVersion).toBe(1);

    const row = await db.transactions.get(Number(mapping!.localId));
    expect(row?.amount).toBe(250);
  });

  it("does NOT clobber an unrelated local row when a pulled record's embedded payload.id collides with it", async () => {
    // This device's own pre-existing, unrelated transaction — happens to
    // have local id 9, same as the foreign device's embedded payload.id.
    await db.transactions.add({
      id: 9,
      type: "EXPENSE",
      date: "2024-01-01",
      timestamp: "2024-01-01T00:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 111,
      amountMainCurrency: 111,
      exchangeRate: 1,
      note: "mine",
      isTrashed: false,
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    } as Parameters<typeof db.transactions.put>[0]);

    const foreignPayload = {
      id: 9, // coincidental collision with the unrelated local row above
      type: "EXPENSE",
      date: "2024-01-01",
      timestamp: "2024-01-01T00:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 999,
      amountMainCurrency: 999,
      exchangeRate: 1,
      note: "foreign",
      isTrashed: false,
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    await writeDecryptedRecord("transaction", foreignPayload, {
      recordId: "tx-foreign-9",
      deletedAt: null,
      addedByUser: "user-remote",
      version: 1,
    });

    // The unrelated local row must be completely untouched.
    const unrelated = await db.transactions.get(9);
    expect(unrelated?.amount).toBe(111);
    expect(unrelated?.note).toBe("mine");

    // The foreign record landed in a DIFFERENT local row.
    const mapping = await getMappingByUuid("tx-foreign-9");
    expect(mapping).toBeDefined();
    expect(Number(mapping!.localId)).not.toBe(9);
    const foreignRow = await db.transactions.get(Number(mapping!.localId));
    expect(foreignRow?.amount).toBe(999);
    expect(foreignRow?.note).toBe("foreign");
  });

  it("settings are keyed by their own string key — no numeric-id translation, no collision risk", async () => {
    await writeDecryptedRecord(
      "settings",
      { key: "mainCurrency", value: "EUR" },
      { recordId: "setting-uuid-1", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const row = await db.settings.get("mainCurrency");
    expect(row?.value).toBe("EUR");

    const mapping = await getMappingByUuid("setting-uuid-1");
    expect(mapping?.localId).toBe("mainCurrency");
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

// ── B-retry-1 — balance-aware pulled transaction/account writes ─────────────

describe("writeDecryptedRecord — balance-aware pulled transactions", () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.accounts.clear();
    await db.recordMappings.clear();
  });

  it("CREATE: applies the new transaction's delta to its account", async () => {
    const accountId = (await db.accounts.add(makeAccount({ balance: 1000 }))) as number;

    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({ accountId, type: "EXPENSE", amount: 150 }),
      { recordId: "tx-create-1", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const account = await db.accounts.get(accountId);
    expect(account?.balance).toBe(850); // 1000 - 150

    const mapping = await getMappingByUuid("tx-create-1");
    expect(mapping).toBeDefined();
    const row = await db.transactions.get(Number(mapping!.localId));
    expect(row?.amount).toBe(150);
  });

  it("CREATE: applies an INCOME delta positively", async () => {
    const accountId = (await db.accounts.add(makeAccount({ balance: 1000 }))) as number;

    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({ accountId, type: "INCOME", amount: 200 }),
      { recordId: "tx-create-income", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const account = await db.accounts.get(accountId);
    expect(account?.balance).toBe(1200);
  });

  it("UPDATE: reverts the OLD row's delta and applies the NEW payload's delta", async () => {
    const accountId = (await db.accounts.add(makeAccount({ balance: 1000 }))) as number;
    const localId = (await db.transactions.add(
      makeTxPayload({ accountId, type: "EXPENSE", amount: 100 }) as Parameters<
        typeof db.transactions.add
      >[0],
    )) as number;
    await upsertMappingFromPull("transaction", String(localId), "tx-update-1", "user-001", 1);
    // Simulate the balance effect the OLD row already had applied.
    await db.accounts.update(accountId, { balance: 1000 - 100 });

    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({ accountId, type: "EXPENSE", amount: 300 }),
      { recordId: "tx-update-1", deletedAt: null, addedByUser: "user-001", version: 2 },
    );

    const account = await db.accounts.get(accountId);
    // 900 (after old EXPENSE 100) + 100 (revert) - 300 (apply new) = 700
    expect(account?.balance).toBe(700);

    const row = await db.transactions.get(localId);
    expect(row?.amount).toBe(300);
  });

  it("UPDATE: handles an accountId change by reverting on the OLD account and applying on the NEW one", async () => {
    const oldAccountId = (await db.accounts.add(makeAccount({ balance: 900 }))) as number; // already -100 applied
    const newAccountId = (await db.accounts.add(makeAccount({ balance: 500 }))) as number;
    const localId = (await db.transactions.add(
      makeTxPayload({ accountId: oldAccountId, type: "EXPENSE", amount: 100 }) as Parameters<
        typeof db.transactions.add
      >[0],
    )) as number;
    await upsertMappingFromPull("transaction", String(localId), "tx-move-account", "user-001", 1);

    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({ accountId: newAccountId, type: "EXPENSE", amount: 50 }),
      { recordId: "tx-move-account", deletedAt: null, addedByUser: "user-001", version: 2 },
    );

    expect((await db.accounts.get(oldAccountId))?.balance).toBe(1000); // 900 + 100 reverted
    expect((await db.accounts.get(newAccountId))?.balance).toBe(450); // 500 - 50 applied
  });

  it("TOMBSTONE: reverts the local row's delta then hard-deletes it", async () => {
    const accountId = (await db.accounts.add(makeAccount({ balance: 700 }))) as number; // 1000 - 300 already applied
    const localId = (await db.transactions.add(
      makeTxPayload({ accountId, type: "EXPENSE", amount: 300 }) as Parameters<
        typeof db.transactions.add
      >[0],
    )) as number;
    await upsertMappingFromPull("transaction", String(localId), "tx-tombstone-1", "user-001", 1);

    await writeDecryptedRecord(
      "transaction",
      { id: localId },
      {
        recordId: "tx-tombstone-1",
        deletedAt: "2024-02-01T00:00:00.000Z",
        addedByUser: "user-001",
        version: 2,
      },
    );

    expect((await db.accounts.get(accountId))?.balance).toBe(1000);
    expect(await db.transactions.get(localId)).toBeUndefined();
  });

  it("CREATE: DEBT principal-only rule — a TRANSFER IN leg on a DEBT account reduces balance by principalAmount only", async () => {
    const debtAccountId = (await db.accounts.add(
      makeAccount({ type: "DEBT", balance: 5000 }),
    )) as number;

    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({
        accountId: debtAccountId,
        type: "TRANSFER",
        transferDirection: "IN",
        amount: 300,
        principalAmount: 250,
        interestAmount: 50,
      }),
      { recordId: "tx-debt-principal", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const account = await db.accounts.get(debtAccountId);
    // DEBT.balance is stored as a POSITIVE amount owed (see
    // balance.service.test.ts "DEBT account exceptions"); a payment's
    // principal-only delta reduces it: 5000 - 250 = 4750.
    expect(account?.balance).toBe(4750);
  });

  it("CREATE: DEBT TRANSFER IN with no principal split reduces balance by the full amount", async () => {
    const debtAccountId = (await db.accounts.add(
      makeAccount({ type: "DEBT", balance: 5000 }),
    )) as number;

    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({
        accountId: debtAccountId,
        type: "TRANSFER",
        transferDirection: "IN",
        amount: 1000,
        principalAmount: null,
      }),
      { recordId: "tx-debt-full", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const account = await db.accounts.get(debtAccountId);
    expect(account?.balance).toBe(4000); // 5000 - 1000
  });

  it("logs a warning and still inserts the row when the transaction's account is not known locally", async () => {
    await writeDecryptedRecord(
      "transaction",
      makeTxPayload({ accountId: 999, type: "EXPENSE", amount: 50 }),
      { recordId: "tx-missing-account", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const mapping = await getMappingByUuid("tx-missing-account");
    expect(mapping).toBeDefined();
    const row = await db.transactions.get(Number(mapping!.localId));
    expect(row?.amount).toBe(50);
    const { logger } = await import("@/services/log.service");
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("account not known locally"),
      expect.anything(),
    );
  });
});

describe("writeDecryptedRecord — account create-snapshot vs existing-account balance preservation (B-retry-1)", () => {
  beforeEach(async () => {
    await db.accounts.clear();
    await db.recordMappings.clear();
  });

  it("a brand-new account is created with the payload's balance verbatim (authoritative snapshot)", async () => {
    await writeDecryptedRecord("account", makeAccount({ balance: 4242 }), {
      recordId: "acc-new-snapshot",
      deletedAt: null,
      addedByUser: "user-001",
      version: 1,
    });

    const mapping = await getMappingByUuid("acc-new-snapshot");
    expect(mapping).toBeDefined();
    const row = await db.accounts.get(Number(mapping!.localId));
    expect(row?.balance).toBe(4242);
  });

  it("an already-known account keeps its own locally-maintained balance, ignoring the payload's balance", async () => {
    const localId = (await db.accounts.add(
      makeAccount({ balance: 999, name: "Local name" }) as Parameters<typeof db.accounts.add>[0],
    )) as number;
    await upsertMappingFromPull("account", String(localId), "acc-existing", "user-001", 1);

    await writeDecryptedRecord(
      "account",
      makeAccount({ balance: 123456, name: "Renamed remotely" }),
      { recordId: "acc-existing", deletedAt: null, addedByUser: "user-001", version: 2 },
    );

    const row = await db.accounts.get(localId);
    // Balance untouched by the incoming payload...
    expect(row?.balance).toBe(999);
    // ...but every other field IS updated from the payload.
    expect(row?.name).toBe("Renamed remotely");
  });
});

// ── B-retry-7 — outbox coalescing ────────────────────────────────────────────

describe("enqueuePush — outbox coalescing", () => {
  it("overwrites a non-terminal pending row for the same (recordType, recordId) instead of adding a second one", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord({ parentVersion: 0 });
    await enqueuePush(record);
    await enqueuePush({ ...record, parentVersion: 1, payload: { amount: 200 } });

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].parentVersion).toBe(1);
  });

  it("does not coalesce into a terminal row — adds a fresh row alongside it", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord();
    await enqueuePush(record);
    const [existing] = await db.pendingUploads.toArray();
    await db.pendingUploads.update(existing.id!, { terminal: true });

    await enqueuePush({ ...record, parentVersion: 2 });

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.terminal)).toBe(true);
    expect(rows.some((r) => !r.terminal && r.parentVersion === 2)).toBe(true);
  });
});

// ── B-retry-3b — deterministic 400 marks the batch terminal ─────────────────

describe("flushOutbox — 400 deterministic rejection (B-retry-3b)", () => {
  it("marks every record in the batch terminal without bumping attempts", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord({ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000400" });
    await enqueuePush(record);

    interface ProblemErr extends Error {
      status: number;
      problem?: { title: string };
    }
    const badRequestErr = new Error("Bad Request") as ProblemErr;
    badRequestErr.status = 400;
    badRequestErr.problem = { title: "invalid parentVersion" };
    vi.mocked(pushRecords).mockRejectedValueOnce(badRequestErr);

    await flushOutbox();

    const rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].terminal).toBe(true);
    expect(rows[0].attempts).toBe(0);

    // A subsequent flush must not call pushRecords again (terminal rows excluded).
    vi.mocked(pushRecords).mockClear();
    await flushOutbox();
    expect(pushRecords).not.toHaveBeenCalled();
  });
});

// ── B-retry-3a — retryTerminalUploads ─────────────────────────────────────────

describe("retryTerminalUploads", () => {
  it("clears the terminal flag and re-flushes, giving the row another chance", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const record = makeRawRecord({ recordId: "aaaaaaaa-bbbb-7ccc-8ddd-000000000413" });
    await enqueuePush(record);

    interface QuotaErr extends Error {
      status: number;
    }
    const quotaErr = new Error("payload too large") as QuotaErr;
    quotaErr.status = 413;
    vi.mocked(pushRecords).mockRejectedValueOnce(quotaErr);
    await flushOutbox();

    let rows = await db.pendingUploads.toArray();
    expect(rows[0].terminal).toBe(true);

    vi.mocked(pushRecords).mockResolvedValueOnce({
      accepted: [{ recordId: record.recordId, version: 1, familySeq: 1 }],
      conflicts: [],
    });

    await retryTerminalUploads();

    rows = await db.pendingUploads.toArray();
    expect(rows).toHaveLength(0);
    expect(pushRecords).toHaveBeenCalledTimes(2);
  });
});

// ── B-retry-6 — pulled settings validation + store cache refresh ────────────

describe("writeDecryptedRecord — settings allow-list + store refresh (B-retry-6)", () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.recordMappings.clear();
  });

  it("applies an allow-listed key (mainCurrency) and refreshes the settings-store cache", async () => {
    const { useSettingsStore } = await import("@/stores/settings-store");
    useSettingsStore.setState({ mainCurrency: "USD" });

    await writeDecryptedRecord(
      "settings",
      { key: "mainCurrency", value: "EUR" },
      { recordId: "setting-allowlisted", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const row = await db.settings.get("mainCurrency");
    expect(row?.value).toBe("EUR");
    expect(useSettingsStore.getState().mainCurrency).toBe("EUR");
  });

  it("drops a key that is not in the sync allow-list, without writing to db.settings", async () => {
    await writeDecryptedRecord(
      "settings",
      { key: "hapticFeedbackEnabled", value: true },
      { recordId: "setting-not-allowlisted", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const row = await db.settings.get("hapticFeedbackEnabled");
    expect(row).toBeUndefined();
    // Dropping is a deliberate skip, not a failure — no mapping is minted either.
    const mapping = await getMappingByUuid("setting-not-allowlisted");
    expect(mapping).toBeUndefined();
  });

  it("drops a payload missing a `value` field", async () => {
    await writeDecryptedRecord(
      "settings",
      { key: "mainCurrency" },
      { recordId: "setting-missing-value", deletedAt: null, addedByUser: "user-001", version: 1 },
    );

    const mapping = await getMappingByUuid("setting-missing-value");
    expect(mapping).toBeUndefined();
  });
});

// ── B-retry-5 — device.revoked ───────────────────────────────────────────────

describe("startLiveSync — device.revoked", () => {
  it("wipes local state and signs out when the revoked deviceId matches this device", async () => {
    mockDevice = { id: "this-device-001" };

    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { assign },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    // Seed DB state with REAL timers active — fake-indexeddb relies on
    // macrotask scheduling internally that fake timers would otherwise
    // starve if enabled before this await.
    await db.transactions.add(
      makeTxPayload({ accountId: 1 }) as Parameters<typeof db.transactions.add>[0],
    );

    vi.useFakeTimers();
    const disconnect = startLiveSync("family-revoked-self");

    capturedSSEOpts!.onEvent("device.revoked", {
      deviceId: "this-device-001",
      reason: "admin-revoked",
    });

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    const { cryptoWorker } = await import("@/services/crypto/worker-client");
    expect(vi.mocked(cryptoWorker.clearAllStoredKeys)).toHaveBeenCalledTimes(1);
    expect(await db.transactions.count()).toBe(0);
    expect(assign).toHaveBeenCalledWith("/onboarding");

    disconnect();
    vi.unstubAllGlobals();
  });

  it("does nothing destructive when the revoked deviceId is a DIFFERENT device", async () => {
    mockDevice = { id: "this-device-001" };

    await db.transactions.add(
      makeTxPayload({ accountId: 1 }) as Parameters<typeof db.transactions.add>[0],
    );

    vi.useFakeTimers();
    const disconnect = startLiveSync("family-revoked-other");

    capturedSSEOpts!.onEvent("device.revoked", {
      deviceId: "some-other-device-002",
      reason: "admin-revoked",
    });

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(1);

    disconnect();
  });
});

// ── B-retry-4a — SSE onOpen triggers a catch-up pull ─────────────────────────

describe("startLiveSync — SSE onOpen triggers a pull", () => {
  it("pulls from the stored cursor whenever the SSE connection (re)opens", async () => {
    await setCursor("family-onopen-001", encodeCursor(5));

    vi.useFakeTimers();
    vi.mocked(pullRecords).mockResolvedValue({
      records: [],
      nextCursor: encodeCursor(5),
      hasMore: false,
    });

    const disconnect = startLiveSync("family-onopen-001");
    expect(capturedSSEOpts).not.toBeNull();

    // connectSSE itself doesn't call onOpen — the sse.ts module is mocked
    // out entirely in this file, so trigger it directly as the real
    // EventSource's onopen handler would.
    capturedSSEOpts!.onOpen?.();

    await vi.runAllTimersAsync();

    expect(pullRecords).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pullRecords).mock.calls[0][0]).toEqual({ since: encodeCursor(5) });

    disconnect();
    vi.useRealTimers();
  });
});

// ── B-retry-2a — window "online" listener ────────────────────────────────────

describe("startLiveSync — window online listener", () => {
  it("flushes the outbox and pulls from the stored cursor when the browser comes online", async () => {
    await setCursor("family-online-001", encodeCursor(3));

    let onlineHandler: (() => void) | null = null;
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === "online") onlineHandler = handler;
      }),
      removeEventListener: vi.fn(),
    });

    vi.mocked(pullRecords).mockResolvedValueOnce({
      records: [],
      nextCursor: encodeCursor(3),
      hasMore: false,
    });

    const disconnect = startLiveSync("family-online-001");
    expect(onlineHandler).not.toBeNull();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    onlineHandler!();

    // Both flushOutbox (fire-and-forget) and pullSince run inside their own
    // async IIFEs — give them a tick to settle (no fake timers involved).
    await new Promise((r) => setTimeout(r, 20));

    expect(pullRecords).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pullRecords).mock.calls[0][0]).toEqual({ since: encodeCursor(3) });

    disconnect();
    vi.unstubAllGlobals();
  });
});
