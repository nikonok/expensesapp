// @vitest-environment node
//
// Worker-client smoke tests. We don't have a real Web Worker in Vitest's Node
// environment, so we install an in-process Worker shim that loads the real
// worker module via the same global hook used by the worker-client. The shim
// gives us a postMessage/onmessage round-trip — the actual crypto code paths
// run in-process, which is fine because they don't depend on any worker-only
// API beyond `self.onmessage` and `self.postMessage` (both stubbed here).
//
// This used to be `describe.skipIf(!hasWorker)` so CI never exercised the
// worker RPC plumbing. B9 turns that into a real PASS in every run.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installWorkerShim, uninstallWorkerShim } from "./worker-shim";

beforeEach(async () => {
  await installWorkerShim();
});
afterEach(() => {
  uninstallWorkerShim();
});

describe("cryptoWorker", () => {
  it("init resolves without error", async () => {
    const { cryptoWorker } = await import("../worker-client");
    await cryptoWorker.init();
  });

  it("ping echoes the payload", async () => {
    const { cryptoWorker } = await import("../worker-client");
    const res = await cryptoWorker.ping("hello");
    expect(res).toBe("hello");
  });
});
