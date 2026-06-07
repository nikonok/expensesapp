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

const enqueuePushMock = vi.mocked(enqueuePush);
const getLocalFamilyIdMock = vi.mocked(getLocalFamilyId);

beforeEach(async () => {
  await db.pendingUploads.clear();
  await db.syncCursors.clear();
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

  it("pushTransaction enqueues a transaction record carrying editor IDs", async () => {
    await pushTransaction({ id: 42, amount: 100 } as never);
    expect(enqueuePushMock).toHaveBeenCalledTimes(1);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("transaction");
    expect(arg.recordId).toBe("42");
    expect(arg.familyId).toBe("family-aaaaaaaa");
    expect(arg.addedByUserId).toBe("user-zzz");
    expect(arg.editedByUserId).toBe("user-zzz");
    expect(arg.deletedAt).toBeUndefined();
  });

  it("pushTransactionTombstone sets deletedAt and isTrashed", async () => {
    await pushTransactionTombstone({ id: 7 } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(typeof arg.deletedAt).toBe("string");
    expect((arg.payload as { isTrashed: boolean }).isTrashed).toBe(true);
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

  it("pushCategory targets the category recordType", async () => {
    await pushCategory({ id: 9, isTrashed: false } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("category");
    expect(arg.recordId).toBe("9");
  });

  it("pushBudget targets the budget recordType", async () => {
    await pushBudget({ id: 3 } as never);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("budget");
    expect(arg.recordId).toBe("3");
  });

  it("pushSetting only pushes synced settings keys", async () => {
    await pushSetting("language", "en");
    expect(enqueuePushMock).not.toHaveBeenCalled();
    await pushSetting("mainCurrency", "USD");
    expect(enqueuePushMock).toHaveBeenCalledTimes(1);
    const arg = enqueuePushMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.recordType).toBe("settings");
    expect(arg.recordId).toBe("setting:mainCurrency");
    expect((arg.payload as { key: string; value: unknown }).key).toBe("mainCurrency");
    expect((arg.payload as { key: string; value: unknown }).value).toBe("USD");
  });
});
