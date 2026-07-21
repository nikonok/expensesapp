// @vitest-environment node

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/database";

// Real Dexie (via fake-indexeddb) backs this test — only the auth store is
// mocked, since `getLocalFamilyId`'s fallback reads `useAuthStore.getState()`.
vi.mock("@/services/auth/session", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ family: null })),
  },
}));

import { useAuthStore } from "@/services/auth/session";
import { getLocalFamilyId, setLocalFamilyId } from "../active-family";
import { getCursor } from "@/services/sync/cursor";

beforeEach(async () => {
  await db.syncCursors.clear();
  vi.mocked(useAuthStore.getState).mockReturnValue({
    family: null,
  } as unknown as ReturnType<typeof useAuthStore.getState>);
});

describe("getLocalFamilyId", () => {
  it("returns null when there is no syncCursors row and no auth-store family", async () => {
    expect(await getLocalFamilyId()).toBeNull();
  });

  it("returns the familyId from the first syncCursors row when one exists", async () => {
    await db.syncCursors.put({
      familyId: "family-from-cursor",
      cursor: "some-cursor",
      updatedAt: new Date().toISOString(),
    });
    expect(await getLocalFamilyId()).toBe("family-from-cursor");
  });

  it("falls back to the auth store's family.id when no syncCursors row exists yet", async () => {
    vi.mocked(useAuthStore.getState).mockReturnValue({
      family: { id: "family-from-auth-store", role: "member" },
    } as unknown as ReturnType<typeof useAuthStore.getState>);
    expect(await getLocalFamilyId()).toBe("family-from-auth-store");
  });

  it("prefers the syncCursors row over the auth-store fallback when both are present", async () => {
    await db.syncCursors.put({
      familyId: "family-from-cursor",
      cursor: "some-cursor",
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(useAuthStore.getState).mockReturnValue({
      family: { id: "family-from-auth-store", role: "member" },
    } as unknown as ReturnType<typeof useAuthStore.getState>);
    expect(await getLocalFamilyId()).toBe("family-from-cursor");
  });
});

describe("setLocalFamilyId", () => {
  it("seeds a syncCursors row with an empty (pull-from-beginning) cursor", async () => {
    await setLocalFamilyId("family-new");
    const cursor = await getCursor("family-new");
    expect(cursor).toBeDefined();
    // Round-trips through getLocalFamilyId once seeded.
    expect(await getLocalFamilyId()).toBe("family-new");
  });

  it("is a no-op when a row for that familyId already exists (never clobbers real pull progress)", async () => {
    await db.syncCursors.put({
      familyId: "family-existing",
      cursor: "real-progress-cursor",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    await setLocalFamilyId("family-existing");
    const row = await db.syncCursors.get("family-existing");
    expect(row?.cursor).toBe("real-progress-cursor");
  });
});
