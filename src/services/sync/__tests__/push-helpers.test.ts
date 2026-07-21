// @vitest-environment node

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/database";

vi.mock("@/services/log.service", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../engine", () => ({
  enqueuePush: vi.fn(async () => undefined),
}));

vi.mock("@/services/family/active-family", () => ({
  getLocalFamilyId: vi.fn(async () => "family-aaaaaaaa"),
}));

vi.mock("@/services/auth/session", () => ({
  useAuthStore: {
    getState: () => ({ user: { id: "user-zzz" } }),
  },
}));

import { enqueuePush } from "../engine";
import { getLocalFamilyId } from "@/services/family/active-family";
import { useAuthStore } from "@/services/auth/session";
import {
  pushAccount,
  pushBudget,
  pushCategory,
  pushSetting,
  pushTransaction,
  pushTransactionTombstone,
} from "../push-helpers";
import { getMappingByLocalId } from "../record-mapping";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enqueuePushMock = vi.mocked(enqueuePush);
const getLocalFamilyIdMock = vi.mocked(getLocalFamilyId);

beforeEach(async () => {
  await db.pendingUploads.clear();
  await db.syncCursors.clear();
  await db.recordMappings.clear();
  enqueuePushMock.mockClear();
  getLocalFamilyIdMock.mockReset();
  getLocalFamilyIdMock.mockResolvedValue("family-aaaaaaaa");
  // Restore the default authenticated user; individual tests override.
  vi.spyOn(useAuthStore, "getState").mockReturnValue({
    user: { id: "user-zzz" },
  } as unknown as ReturnType<typeof useAuthStore.getState>);
});

describe("push-helpers", () => {
  it("no-ops when there is no active family", async () => {
    getLocalFamilyIdMock.mockResolvedValueOnce(null);
    await pushTransaction({ id: 1 } as never);
    expect(enqueuePushMock).not.toHaveBeenCalled();
  });

  it("no-ops when there is no signed-in user", async () => {
    vi.spyOn(useAuthStore, "getState").mockReturnValue({
      user: null,
    } as unknown as ReturnType<typeof useAuthStore.getState>);
    await pushTransaction({ id: 1 } as never);
    expect(enqueuePushMock).not.toHaveBeenCalled();
  });

  it("pushTransaction enqueues a transaction record with a real UUID recordId (not the raw Dexie id)", async () => {
    await pushTransaction({ id: 42, amount: 100 } as never);
    expect(enqueuePushMock).toHaveBeenCalledTimes(1);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("transaction");
    expect(arg.recordId).toMatch(UUID_RE);
    expect(arg.recordId).not.toBe("42");
    expect(arg.familyId).toBe("family-aaaaaaaa");
    expect(arg.addedByUserId).toBe("user-zzz");
    expect(arg.editedByUserId).toBe("user-zzz");
    expect(arg.deletedAt).toBeUndefined();
    expect(arg.parentVersion).toBe(0);
  });

  it("pushTransaction reuses the same recordId across repeated pushes of the same local row", async () => {
    await pushTransaction({ id: 42, amount: 100 } as never);
    await pushTransaction({ id: 42, amount: 150 } as never);
    const first = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    const second = enqueuePushMock.mock.calls[1][0] as unknown as Record<string, unknown>;
    expect(second.recordId).toBe(first.recordId);
  });

  it("mints a mapping row on first push and persists creatorUserId", async () => {
    await pushTransaction({ id: 100, amount: 5 } as never);
    const mapping = await getMappingByLocalId("transaction", "100");
    expect(mapping).toBeDefined();
    expect(mapping!.uuid).toMatch(UUID_RE);
    expect(mapping!.creatorUserId).toBe("user-zzz");
    expect(mapping!.lastServerVersion).toBe(0);
  });

  it("preserves the ORIGINAL creator on a later edit by a different user", async () => {
    // First push: user-zzz creates the record.
    await pushTransaction({ id: 200, amount: 5 } as never);

    // A different user (e.g. after a family-key swap on this device, or a
    // test double for "another device's edit round-tripped in") edits it.
    vi.spyOn(useAuthStore, "getState").mockReturnValue({
      user: { id: "user-other" },
    } as unknown as ReturnType<typeof useAuthStore.getState>);
    await pushTransaction({ id: 200, amount: 9 } as never);

    const second = enqueuePushMock.mock.calls[1][0] as unknown as Record<string, unknown>;
    expect(second.addedByUserId).toBe("user-zzz"); // original creator preserved
    expect(second.editedByUserId).toBe("user-other"); // current editor
  });

  it("pushTransactionTombstone sets deletedAt and isTrashed", async () => {
    await pushTransactionTombstone({ id: 7 } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(typeof arg.deletedAt).toBe("string");
    expect((arg.payload as { isTrashed: boolean }).isTrashed).toBe(true);
    expect(arg.recordId).toMatch(UUID_RE);
  });

  it("pushAccount marks deletedAt when account is trashed", async () => {
    await pushAccount({ id: 1, isTrashed: true } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(typeof arg.deletedAt).toBe("string");
  });

  it("pushAccount leaves deletedAt undefined when account is not trashed", async () => {
    await pushAccount({ id: 1, isTrashed: false } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.deletedAt).toBeUndefined();
  });

  it("pushCategory targets the category recordType with a UUID recordId", async () => {
    await pushCategory({ id: 9, isTrashed: false } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("category");
    expect(arg.recordId).toMatch(UUID_RE);
  });

  it("pushBudget targets the budget recordType with a UUID recordId", async () => {
    await pushBudget({ id: 3 } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("budget");
    expect(arg.recordId).toMatch(UUID_RE);
  });

  it("pushSetting only pushes synced settings keys, and drops the phantom monthStartDay key", async () => {
    await pushSetting("language", "en");
    expect(enqueuePushMock).not.toHaveBeenCalled();
    await pushSetting("monthStartDay", 1);
    expect(enqueuePushMock).not.toHaveBeenCalled();
    await pushSetting("mainCurrency", "USD");
    expect(enqueuePushMock).toHaveBeenCalledTimes(1);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("settings");
    expect(arg.recordId).toMatch(UUID_RE);
    expect((arg.payload as { key: string; value: unknown }).key).toBe("mainCurrency");
    expect((arg.payload as { key: string; value: unknown }).value).toBe("USD");
  });

  it("pushSetting mints one mapping per setting key, keyed by localId=key", async () => {
    await pushSetting("mainCurrency", "USD");
    const mapping = await getMappingByLocalId("settings", "mainCurrency");
    expect(mapping).toBeDefined();
    expect(mapping!.uuid).toMatch(UUID_RE);
  });
});
