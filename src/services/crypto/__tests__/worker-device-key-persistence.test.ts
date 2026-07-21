// @vitest-environment node
//
// getDevicePublicKey must fall back to the persisted key in the worker's
// IndexedDB when the in-memory cache is empty — this is exactly what happens
// after a page reload spawns a brand-new worker instance with no cached
// state, even though the device keypair itself is still on disk.
//
// We simulate "reload" by re-installing the worker shim (fresh module
// registry, cachedDevicePubKey/cachedDevicePrivKey reset to null) while
// reusing the same underlying fake-indexeddb store, which — like real
// IndexedDB — persists independently of the worker module instance.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installWorkerShim, uninstallWorkerShim } from "./worker-shim";

beforeEach(async () => {
  await installWorkerShim();
});
afterEach(() => {
  uninstallWorkerShim();
});

describe("getDevicePublicKey persisted fallback", () => {
  it("returns null before any device key has been generated", async () => {
    const { cryptoWorker } = await import("../worker-client");
    const pub = await cryptoWorker.getDevicePublicKey();
    expect(pub).toBeNull();
  });

  it("reuses the persisted key across a simulated reload (fresh worker instance)", async () => {
    const { cryptoWorker } = await import("../worker-client");
    const generated = await cryptoWorker.generateAndPersistDeviceKey();
    expect(generated).toBeInstanceOf(Uint8Array);

    // Sanity: the cache serves it back immediately, same worker instance.
    const cached = await cryptoWorker.getDevicePublicKey();
    expect(Array.from(cached!)).toEqual(Array.from(generated));

    // Simulate a reload: tear down and reinstall the shim. This resets the
    // module registry (so `worker.ts` re-evaluates with fresh
    // cachedDevicePubKey/cachedDevicePrivKey = null), but the fake-indexeddb
    // backing store is process-global and survives, exactly like real
    // IndexedDB survives a page reload.
    uninstallWorkerShim();
    await installWorkerShim();

    const { cryptoWorker: freshCryptoWorker } = await import("../worker-client");
    const afterReload = await freshCryptoWorker.getDevicePublicKey();
    expect(afterReload).not.toBeNull();
    expect(Array.from(afterReload!)).toEqual(Array.from(generated));
  });
});
