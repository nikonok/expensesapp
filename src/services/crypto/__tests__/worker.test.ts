import { describe, it, expect } from "vitest";

// Web Workers are not available in the Node.js test environment used by Vitest.
// The real worker round-trip is exercised in the Phase 2 dev playground (2.demo).
// These tests are skipped rather than failing so CI stays green.
const hasWorker = typeof Worker !== "undefined";

describe("cryptoWorker", () => {
  it.skipIf(!hasWorker)("init resolves without error", async () => {
    const { cryptoWorker } = await import("../worker-client");
    await cryptoWorker.init();
  });

  it.skipIf(!hasWorker)("ping echoes the payload", async () => {
    const { cryptoWorker } = await import("../worker-client");
    const res = await cryptoWorker.ping("hello");
    expect(res).toBe("hello");
  });
});
