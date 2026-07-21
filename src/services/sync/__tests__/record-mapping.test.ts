// @vitest-environment node

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/database";
import {
  getMappingByLocalId,
  getMappingByUuid,
  getOrCreateMappingForPush,
  updateLastServerVersion,
  upsertMappingFromPull,
} from "../record-mapping";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(async () => {
  await db.recordMappings.clear();
});

describe("getOrCreateMappingForPush", () => {
  it("mints a fresh UUID mapping on first call, recording the caller as creator", async () => {
    const mapping = await getOrCreateMappingForPush("transaction", "1", "user-a");
    expect(mapping.uuid).toMatch(UUID_RE);
    expect(mapping.recordType).toBe("transaction");
    expect(mapping.localId).toBe("1");
    expect(mapping.creatorUserId).toBe("user-a");
    expect(mapping.lastServerVersion).toBe(0);
  });

  it("returns the SAME mapping (same uuid, same creator) on a subsequent call for the same local row", async () => {
    const first = await getOrCreateMappingForPush("transaction", "1", "user-a");
    // A later edit by a DIFFERENT user must not steal creatorUserId or mint a
    // new uuid — the mapping is immutable once created.
    const second = await getOrCreateMappingForPush("transaction", "1", "user-b");
    expect(second.uuid).toBe(first.uuid);
    expect(second.creatorUserId).toBe("user-a");
  });

  it("mints distinct mappings for different (recordType, localId) pairs", async () => {
    const tx1 = await getOrCreateMappingForPush("transaction", "1", "user-a");
    const tx2 = await getOrCreateMappingForPush("transaction", "2", "user-a");
    const acc1 = await getOrCreateMappingForPush("account", "1", "user-a");
    expect(tx1.uuid).not.toBe(tx2.uuid);
    expect(tx1.uuid).not.toBe(acc1.uuid);
  });

  it("settings mappings are keyed by the setting key string as localId", async () => {
    const mapping = await getOrCreateMappingForPush("settings", "mainCurrency", "user-a");
    expect(mapping.localId).toBe("mainCurrency");
    const lookup = await getMappingByLocalId("settings", "mainCurrency");
    expect(lookup?.uuid).toBe(mapping.uuid);
  });
});

describe("getMappingByLocalId / getMappingByUuid", () => {
  it("resolves the same row from either direction", async () => {
    const created = await getOrCreateMappingForPush("account", "7", "user-a");

    const byLocalId = await getMappingByLocalId("account", "7");
    expect(byLocalId?.uuid).toBe(created.uuid);

    const byUuid = await getMappingByUuid(created.uuid);
    expect(byUuid?.localId).toBe("7");
    expect(byUuid?.recordType).toBe("account");
  });

  it("returns undefined for an unknown localId or uuid", async () => {
    expect(await getMappingByLocalId("account", "does-not-exist")).toBeUndefined();
    expect(await getMappingByUuid("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});

describe("updateLastServerVersion", () => {
  it("persists the new version for an existing mapping", async () => {
    await getOrCreateMappingForPush("budget", "5", "user-a");
    await updateLastServerVersion("budget", "5", 3);
    const mapping = await getMappingByLocalId("budget", "5");
    expect(mapping?.lastServerVersion).toBe(3);
  });

  it("is a no-op when no mapping exists yet", async () => {
    await expect(updateLastServerVersion("budget", "no-such-row", 3)).resolves.toBeUndefined();
    expect(await getMappingByLocalId("budget", "no-such-row")).toBeUndefined();
  });
});

describe("upsertMappingFromPull", () => {
  it("creates a brand-new mapping for a record first seen via pull", async () => {
    await upsertMappingFromPull(
      "category",
      "12",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "user-remote",
      1,
    );
    const mapping = await getMappingByLocalId("category", "12");
    expect(mapping?.uuid).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(mapping?.creatorUserId).toBe("user-remote");
    expect(mapping?.lastServerVersion).toBe(1);
  });

  it("refreshes lastServerVersion on a re-pull without discarding the original creator", async () => {
    const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await upsertMappingFromPull("category", "12", uuid, "user-remote", 1);
    // A self-pushed record round-trips back through pull with a bumped
    // version; `creatorUserId` passed here reflects the (unchanged) server
    // truth, but the important invariant is version bookkeeping stays fresh.
    await upsertMappingFromPull("category", "12", uuid, "user-remote", 2);
    const mapping = await getMappingByLocalId("category", "12");
    expect(mapping?.lastServerVersion).toBe(2);
    expect(mapping?.creatorUserId).toBe("user-remote");
  });
});
