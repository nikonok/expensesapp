// @vitest-environment node

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db/database";
import { getCursor, setCursor, encodeCursor, decodeCursor } from "../cursor";

beforeEach(async () => {
  // Clear the syncCursors table before each test for isolation.
  await db.syncCursors.clear();
});

describe("getCursor / setCursor", () => {
  it("returns undefined when no cursor has been set", async () => {
    const result = await getCursor("family-001");
    expect(result).toBeUndefined();
  });

  it("round-trips a cursor value", async () => {
    const familyId = "family-abc";
    const cursor = "eyJmYW1pbHlTZXEiOjQyfQ==";

    await setCursor(familyId, cursor);
    const retrieved = await getCursor(familyId);

    expect(retrieved).toBe(cursor);
  });

  it("updates an existing cursor on overwrite", async () => {
    const familyId = "family-xyz";

    await setCursor(familyId, "cursor-v1");
    await setCursor(familyId, "cursor-v2");

    const result = await getCursor(familyId);
    expect(result).toBe("cursor-v2");
  });

  it("handles multiple families independently", async () => {
    await setCursor("family-1", "cursor-for-1");
    await setCursor("family-2", "cursor-for-2");

    expect(await getCursor("family-1")).toBe("cursor-for-1");
    expect(await getCursor("family-2")).toBe("cursor-for-2");
    expect(await getCursor("family-3")).toBeUndefined();
  });

  it("persists updatedAt as an ISO-8601 string", async () => {
    const before = Date.now();
    await setCursor("family-ts", "some-cursor");
    const after = Date.now();

    const row = await db.syncCursors.get("family-ts");
    expect(row).toBeDefined();
    const ts = new Date(row!.updatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("decodeCursor", () => {
  it("round-trips through encodeCursor for a range of seqs", () => {
    for (const seq of [0, 1, 9, 42, 1000, 123456789]) {
      expect(decodeCursor(encodeCursor(seq))).toBe(seq);
    }
  });

  it("decodes an undefined/empty cursor as 0 (pull-from-beginning)", () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("")).toBe(0);
  });

  it("decodes a malformed cursor defensively as 0 rather than throwing", () => {
    expect(decodeCursor("not-valid-base64url!!!")).toBe(0);
    expect(decodeCursor("QQ")).toBe(0); // valid base64url, wrong byte length
  });
});
