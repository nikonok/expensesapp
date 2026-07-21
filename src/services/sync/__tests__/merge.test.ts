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

  it("treats UTC Z and equivalent +HH:MM offset as the same moment", () => {
    // 2024-06-01T12:00:00.000Z === 2024-06-01T14:00:00.000+02:00
    // Both represent the same instant; neither should consistently "win" on
    // a direct string compare — Date parsing normalises them to the same ms.
    const utcTs = "2024-06-01T12:00:00.000Z";
    const offsetTs = "2024-06-01T14:00:00.000+02:00";

    const local = { amount: 100 };
    const server = { amount: 200 };

    // local uses UTC, server uses +02:00 offset — same instant → tie.
    const localMap = { amount: utcTs };
    const serverMap = { amount: offsetTs };

    const { mergedPayload: mp1 } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      "user-a",
      "user-z",
    );
    // Tie → editedByUserId tie-break: "user-z" > "user-a" → server wins.
    expect(mp1.amount).toBe(200);

    const { mergedPayload: mp2 } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      "user-z",
      "user-a",
    );
    // Tie → editedByUserId tie-break: "user-z" > "user-a" → local wins.
    expect(mp2.amount).toBe(100);
  });

  it("_all whole-record LWW: server wins when server ts is later, entire local payload discarded", () => {
    const local = { amount: 100, note: "local edit", extraLocalOnlyField: "x" };
    const server = { amount: 200, note: "server edit" };
    const localMap = { _all: "2024-01-01T00:00:00.000Z" };
    const serverMap = { _all: "2024-06-01T00:00:00.000Z" };

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    // Whole server payload wins outright — no field-level mixing, and the
    // local-only field must NOT survive.
    expect(mergedPayload).toEqual(server);
    expect(mergedPayload).not.toHaveProperty("extraLocalOnlyField");
    expect(mergedMap).toEqual({ _all: "2024-06-01T00:00:00.000Z" });
  });

  it("_all whole-record LWW: local wins when local ts is later, entire local payload wins", () => {
    const local = { amount: 999, note: "local edit" };
    const server = { amount: 1, note: "server edit", extraServerOnlyField: "y" };
    const localMap = { _all: "2025-01-01T00:00:00.000Z" };
    const serverMap = { _all: "2024-01-01T00:00:00.000Z" };

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    expect(mergedPayload).toEqual(local);
    expect(mergedPayload).not.toHaveProperty("extraServerOnlyField");
    expect(mergedMap).toEqual({ _all: "2025-01-01T00:00:00.000Z" });
  });

  it("_all whole-record LWW: tie breaks by editedByUserId, not by field", () => {
    const ts = "2024-06-01T12:00:00.000Z";
    const local = { flag: "from-local" };
    const server = { flag: "from-server" };
    const localMap = { _all: ts };
    const serverMap = { _all: ts };

    const { mergedPayload: winLocal } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      "user-z",
      "user-a",
    );
    expect(winLocal).toEqual(local);

    const { mergedPayload: winServer } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      "user-a",
      "user-z",
    );
    expect(winServer).toEqual(server);
  });

  it("_all whole-record LWW: treated even if only one side carries the sentinel", () => {
    // Defensive: a legacy per-field local map merging against a server `_all`
    // map (or vice versa) still routes through whole-record semantics rather
    // than silently falling through to per-field (which would look up the
    // nonexistent "_all" payload field and corrupt the merge).
    const local = { amount: 100 };
    const server = { amount: 200 };
    const localMap = { amount: "2025-01-01T00:00:00.000Z" };
    const serverMap = { _all: "2024-01-01T00:00:00.000Z" };

    const { mergedPayload, mergedMap } = mergePayloads(
      local,
      server,
      localMap,
      serverMap,
      LOCAL,
      SERVER,
    );

    // local's map has no `_all` timestamp → treated as -Infinity → server
    // (which does have `_all`) wins outright.
    expect(mergedPayload).toEqual(server);
    expect(mergedMap).toEqual({ _all: "2024-01-01T00:00:00.000Z" });
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
