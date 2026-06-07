// @vitest-environment node
//
// Contract test for the POST /v1/family/migrate-solo client → server wire
// format. The backend handler (backend/internal/family/handlers.go:362-388)
// requires every field below to be present and rejects requests that omit
// them with 400. This test guards us against silent regressions in the wire
// shape; see WORK_PLAN.md brief B2.

import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock the crypto worker to avoid bringing in the Web Worker bundle.
// `migrateSoloRecords` now does the heavy lifting (unwrap → encrypt → persist)
// inside the worker; the test mock echoes back the input batch with a fake
// blob + byte count so the migrate caller's wire-shape can still be inspected.
vi.mock("@/services/crypto/worker-client", () => ({
  cryptoWorker: {
    migrateSoloRecords: vi.fn(
      async (
        _envelope: Uint8Array,
        _persist: boolean,
        records: Array<{ recordType: string; recordId: string }>,
      ) =>
        records.map((r) => ({
          recordType: r.recordType,
          recordId: r.recordId,
          blob: new Uint8Array(64).fill(7),
          plaintextByteCount: 42,
        })),
    ),
  },
}));

// Mock apiFetch (used by both client.ts and session.ts).
vi.mock("@/services/auth/client", () => ({
  apiFetch: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── migrateSolo wire shape ────────────────────────────────────────────────────

describe("migrateSolo wire format", () => {
  it("sends every required field with the correct shape", async () => {
    const { migrateSolo } = await import("@/services/family/client");
    const { apiFetch } = await import("@/services/auth/client");

    const records = [
      {
        recordType: "transaction",
        recordId: "11111111-2222-4333-8444-555555555555",
        blob: "abc",
        updatedAtMap: { _all: "2026-06-07T00:00:00.000Z" },
        addedByUser: "user-1",
        editedByUser: "user-1",
        deletedAt: undefined,
        plaintextByteCount: 100,
      },
    ];

    await migrateSolo("mig-id-001", "family-xyz", records);

    expect(apiFetch).toHaveBeenCalledOnce();
    const [path, init] = (apiFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(path).toBe("/api/v1/family/migrate-solo");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as {
      migrationId: string;
      targetFamilyId: string;
      records: Array<{
        recordId: string;
        recordType: string;
        blob: string;
        updatedAtMap: unknown;
        addedByUser: string;
        editedByUser: string;
        deletedAt: string;
        plaintextByteCount: number;
      }>;
    };

    // Top-level fields the backend requires.
    expect(body.migrationId).toBe("mig-id-001");
    expect(body.targetFamilyId).toBe("family-xyz");
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.records).toHaveLength(1);

    const rec = body.records[0];
    expect(rec.recordId).toBe("11111111-2222-4333-8444-555555555555");
    expect(rec.recordType).toBe("transaction");
    expect(rec.blob).toBe("abc");
    expect(rec.addedByUser).toBe("user-1");
    expect(rec.editedByUser).toBe("user-1");
    expect(rec.plaintextByteCount).toBe(100);

    // updatedAtMap MUST be a JSON-encoded string on the wire, not an object.
    expect(typeof rec.updatedAtMap).toBe("string");
    const parsed = JSON.parse(rec.updatedAtMap as string) as Record<string, string>;
    expect(parsed._all).toBe("2026-06-07T00:00:00.000Z");

    // deletedAt is sent as empty string when undefined locally (backend treats
    // empty as "not deleted" — see handlers.go).
    expect(rec.deletedAt).toBe("");
  });

  it("encodes deletedAt when provided", async () => {
    const { migrateSolo } = await import("@/services/family/client");
    const { apiFetch } = await import("@/services/auth/client");

    await migrateSolo("mig-id-002", "family-xyz", [
      {
        recordType: "account",
        recordId: "rid-1",
        blob: "x",
        updatedAtMap: { _all: "t" },
        addedByUser: "u",
        editedByUser: "u",
        deletedAt: "2026-06-07T00:00:00.000Z",
        plaintextByteCount: 1,
      },
    ]);

    const [, init] = (apiFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { records: Array<{ deletedAt: string }> };
    expect(body.records[0].deletedAt).toBe("2026-06-07T00:00:00.000Z");
  });
});

// ── migrateSoloRecordsToFamily — end-to-end contract ─────────────────────────

describe("migrateSoloRecordsToFamily", () => {
  it("populates every required field for the backend", async () => {
    // Reset modules so the fake-indexeddb state is clean between tests.
    vi.resetModules();

    const { apiFetch } = await import("@/services/auth/client");
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // Seed an authenticated user so addedByUser/editedByUser are populated.
    const { useAuthStore } = await import("@/services/auth/session");
    useAuthStore.setState({
      user: {
        id: "user-current-id",
        email: "me@example.com",
        displayName: "Me",
        isAdmin: false,
        isRoot: false,
      },
      device: { id: "dev-1", label: "Test" },
      isSignedIn: true,
    });

    // Seed one record of each type into Dexie.
    const { db } = await import("@/db/database");
    await db.transactions.add({
      type: "EXPENSE",
      date: "2026-06-07",
      timestamp: "2026-06-07T00:00:00.000Z",
      displayOrder: 0,
      accountId: 1,
      categoryId: 1,
      currency: "USD",
      amount: 100,
      amountMainCurrency: 100,
      exchangeRate: 1,
      note: "test",
      transferGroupId: null,
      transferDirection: null,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    });

    const { migrateSoloRecordsToFamily } = await import("@/services/family/migrate");
    await migrateSoloRecordsToFamily("family-target", new Uint8Array(32).fill(1));

    expect(apiFetch).toHaveBeenCalledOnce();
    const [, init] = (apiFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      migrationId: string;
      targetFamilyId: string;
      records: Array<{
        recordId: string;
        recordType: string;
        blob: string;
        updatedAtMap: unknown;
        addedByUser: string;
        editedByUser: string;
        plaintextByteCount: number;
      }>;
    };

    // migrationId is present and UUID-ish (any non-empty string is fine — the
    // contract only requires it to be present + stable).
    expect(typeof body.migrationId).toBe("string");
    expect(body.migrationId.length).toBeGreaterThan(0);

    // targetFamilyId is the value the caller passed in.
    expect(body.targetFamilyId).toBe("family-target");

    // Exactly one record (the transaction we seeded).
    expect(body.records).toHaveLength(1);
    const rec = body.records[0];

    // recordId is a UUID, NOT the Dexie integer key.
    expect(rec.recordId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // addedByUser / editedByUser carry the current user id.
    expect(rec.addedByUser).toBe("user-current-id");
    expect(rec.editedByUser).toBe("user-current-id");

    // updatedAtMap is wire-encoded as a string (not an object).
    expect(typeof rec.updatedAtMap).toBe("string");
    const parsed = JSON.parse(rec.updatedAtMap as string) as Record<string, string>;
    expect(parsed._all).toBeDefined();
  });

  it("reuses the same migrationId on retry (idempotency)", async () => {
    vi.resetModules();

    const { apiFetch } = await import("@/services/auth/client");
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { useAuthStore } = await import("@/services/auth/session");
    useAuthStore.setState({
      user: {
        id: "user-retry",
        email: "me@example.com",
        displayName: "Me",
        isAdmin: false,
        isRoot: false,
      },
      device: { id: "dev-1", label: "Test" },
      isSignedIn: true,
    });

    const { migrateSoloRecordsToFamily } = await import("@/services/family/migrate");
    await migrateSoloRecordsToFamily("family-target-retry", new Uint8Array(32).fill(1));
    await migrateSoloRecordsToFamily("family-target-retry", new Uint8Array(32).fill(1));

    const calls = (apiFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);

    const body1 = JSON.parse((calls[0][1] as RequestInit).body as string) as {
      migrationId: string;
    };
    const body2 = JSON.parse((calls[1][1] as RequestInit).body as string) as {
      migrationId: string;
    };
    expect(body1.migrationId).toBe(body2.migrationId);
  });

  it("reuses the same recordId for the same Dexie row across retries", async () => {
    vi.resetModules();

    const { apiFetch } = await import("@/services/auth/client");
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { useAuthStore } = await import("@/services/auth/session");
    useAuthStore.setState({
      user: {
        id: "user-stable-rid",
        email: "me@example.com",
        displayName: "Me",
        isAdmin: false,
        isRoot: false,
      },
      device: { id: "dev-1", label: "Test" },
      isSignedIn: true,
    });

    const { db } = await import("@/db/database");
    await db.accounts.add({
      name: "A",
      type: "REGULAR",
      color: "x",
      icon: "x",
      currency: "USD",
      description: "",
      balance: 0,
      startingBalance: 0,
      includeInTotal: true,
      isTrashed: false,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    });

    const { migrateSoloRecordsToFamily } = await import("@/services/family/migrate");
    await migrateSoloRecordsToFamily("family-stable-rid", new Uint8Array(32).fill(1));
    await migrateSoloRecordsToFamily("family-stable-rid", new Uint8Array(32).fill(1));

    const calls = (apiFetch as ReturnType<typeof vi.fn>).mock.calls;
    const body1 = JSON.parse((calls[0][1] as RequestInit).body as string) as {
      records: Array<{ recordId: string; recordType: string }>;
    };
    const body2 = JSON.parse((calls[1][1] as RequestInit).body as string) as {
      records: Array<{ recordId: string; recordType: string }>;
    };
    const acc1 = body1.records.find((r) => r.recordType === "account");
    const acc2 = body2.records.find((r) => r.recordType === "account");
    expect(acc1).toBeDefined();
    expect(acc2).toBeDefined();
    expect(acc1!.recordId).toBe(acc2!.recordId);
  });

  it("throws when no user is signed in (refuses to upload)", async () => {
    vi.resetModules();

    const { useAuthStore } = await import("@/services/auth/session");
    useAuthStore.setState({
      user: null,
      device: null,
      isSignedIn: false,
    });

    const { migrateSoloRecordsToFamily } = await import("@/services/family/migrate");
    await expect(
      migrateSoloRecordsToFamily("family-x", new Uint8Array(32).fill(1)),
    ).rejects.toThrow(/no signed-in user/);
  });
});
