// @vitest-environment node

import { describe, it, expect } from "vitest";
import { mergePayloads } from "../merge";

describe("mergePayloads — LWW semantics", () => {
  const LOCAL = "user-local";
  const SERVER = "user-server";

  it("server wins when server ts is later", () => {
    const local = { amount: 100, note: "old" };
    const server = { amount: 200, note: "new" };
    const localMap = { amount: "2024-01-01T00:00:00.000Z", note: "2024-01-01T00:00:00.000Z" };
    const serverMap = { amount: "2024-06-01T00:00:00.000Z", note: "2024-06-01T00:00:00.000Z" };

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    expect(mergedPayload.amount).toBe(200);
    expect(mergedPayload.note).toBe("new");
    expect(mergedMap.amount).toBe("2024-06-01T00:00:00.000Z");
  });

  it("local wins when local ts is later", () => {
    const local = { amount: 999 };
    const server = { amount: 1 };
    const localMap = { amount: "2025-01-01T00:00:00.000Z" };
    const serverMap = { amount: "2024-01-01T00:00:00.000Z" };

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    expect(mergedPayload.amount).toBe(999);
    expect(mergedMap.amount).toBe("2025-01-01T00:00:00.000Z");
  });

  it("per-field independence: local wins on amount, server wins on note", () => {
    const local = { amount: 500, note: "local-note" };
    const server = { amount: 1, note: "server-note" };
    const localMap = {
      amount: "2025-01-01T00:00:00.000Z",
      note: "2024-01-01T00:00:00.000Z",
    };
    const serverMap = {
      amount: "2024-01-01T00:00:00.000Z",
      note: "2025-01-01T00:00:00.000Z",
    };

    const { mergedPayload } = mergePayloads(local, server, localMap, serverMap, LOCAL, SERVER);

    expect(mergedPayload.amount).toBe(500);
    expect(mergedPayload.note).toBe("server-note");
  });

  it("tie-break: higher lexicographic editedByUserId wins", () => {
    const ts = "2024-06-01T12:00:00.000Z";
    const local = { flag: "from-local" };
    const server = { flag: "from-server" };
    const localMap = { flag: ts };
    const serverMap = { flag: ts };

    // "user-z" > "user-a" → local wins
    const { mergedPayload } = mergePayloads(local, server, localMap, serverMap, "user-z", "user-a");
    expect(mergedPayload.flag).toBe("from-local");

    // "user-a" < "user-z" → server wins
    const { mergedPayload: mp2 } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      "user-a",
      "user-z",
    );
    expect(mp2.flag).toBe("from-server");
  });

  it("tie-break: identical editedByUserId → server wins (server is already in merged)", () => {
    const ts = "2024-06-01T12:00:00.000Z";
    const local = { x: "local" };
    const server = { x: "server" };
    const map = { x: ts };

    const { mergedPayload } = mergePayloads(local, server, map, map, "same-user", "same-user");
    expect(mergedPayload.x).toBe("server");
  });

  it("field only in local map → local value used", () => {
    const local = { newField: "hello" };
    const server = {};
    const localMap = { newField: "2025-01-01T00:00:00.000Z" };
    const serverMap = {};

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    expect(mergedPayload.newField).toBe("hello");
    expect(mergedMap.newField).toBe("2025-01-01T00:00:00.000Z");
  });

  it("field only in server map → server value retained", () => {
    const local = {};
    const server = { serverOnly: 42 };
    const localMap = {};
    const serverMap = { serverOnly: "2025-01-01T00:00:00.000Z" };

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    expect(mergedPayload.serverOnly).toBe(42);
    expect(mergedMap.serverOnly).toBe("2025-01-01T00:00:00.000Z");
  });

  it("returns the full mergedMap for re-encryption", () => {
    const local = { a: 1, b: 2 };
    const server = { a: 10, b: 20 };
    const localMap = {
      a: "2025-01-01T00:00:00.000Z",
      b: "2024-01-01T00:00:00.000Z",
    };
    const serverMap = {
      a: "2024-01-01T00:00:00.000Z",
      b: "2025-01-01T00:00:00.000Z",
    };

    const { mergedMap } = mergePayloads(local, server, localMap, serverMap, LOCAL, SERVER);

    expect(mergedMap.a).toBe("2025-01-01T00:00:00.000Z"); // local won
    expect(mergedMap.b).toBe("2025-01-01T00:00:00.000Z"); // server won
  });
});
