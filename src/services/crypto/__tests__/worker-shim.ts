// In-process Web Worker shim used by `worker.test.ts` and
// `worker.crypto.test.ts` so Vitest (Node environment, no real Worker global)
// can still exercise the worker RPC plumbing in CI.
//
// The shim provides two halves:
//
//   1. A `self`-like proxy installed on `globalThis` BEFORE the worker module
//      is imported. The worker assigns `self.onmessage = ...` and calls
//      `self.postMessage(...)`; both end up on this proxy instead of the real
//      DedicatedWorkerGlobalScope.
//
//   2. A `Worker`-shaped class that bridges main-thread `postMessage` into the
//      proxy's stored `onmessage`, and forwards the worker's `postMessage`
//      back out to the instance's `onmessage` (the main-thread callback).
//
// The shim is wired into `worker-client.ts` by mocking the
// "./worker?worker" import to return our class. This means *the actual code
// from `worker.ts` runs* — no duplicated logic — and the message round-trip is
// measured end-to-end.

import { vi } from "vitest";
import "fake-indexeddb/auto";

interface WorkerProxySelf {
  onmessage: ((e: MessageEvent) => void | Promise<void>) | null;
  postMessage(msg: unknown): void;
}

interface ShimWorkerInstance {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

// Tracks the active proxy so we can route `self.postMessage` calls back to the
// matching main-thread Worker instance.
let activeWorkerInstance: ShimWorkerInstance | null = null;

class ShimWorker implements ShimWorkerInstance {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    activeWorkerInstance = this;
  }
  postMessage(msg: unknown): void {
    // Defer so callers can install `onmessage` before the worker replies, the
    // same way a real Worker would (messages are async).
    queueMicrotask(() => {
      const proxy = (globalThis as unknown as { self: WorkerProxySelf }).self;
      if (!proxy || typeof proxy.onmessage !== "function") return;
      try {
        proxy.onmessage({ data: msg } as MessageEvent);
      } catch (err) {
        if (this.onerror) {
          this.onerror({ message: err instanceof Error ? err.message : String(err) } as ErrorEvent);
        }
      }
    });
  }
  terminate(): void {
    activeWorkerInstance = null;
  }
}

let installed = false;
let originalSelf: unknown;
let hadOriginalSelf = false;

/**
 * Install the shim. Must be called BEFORE the first import of `worker-client`.
 * The mock on "../worker?worker" is module-level so it survives across tests
 * within the same file.
 */
export async function installWorkerShim(): Promise<void> {
  if (installed) return;
  installed = true;

  // Provide a Web-Worker-like `self` global that the worker module assigns to.
  const proxy: WorkerProxySelf = {
    onmessage: null,
    postMessage(msg: unknown) {
      // Forward to the main-thread Worker instance's onmessage handler.
      if (!activeWorkerInstance || !activeWorkerInstance.onmessage) return;
      // Microtask defer to mirror real Worker postMessage semantics.
      queueMicrotask(() => {
        activeWorkerInstance!.onmessage!({ data: msg } as MessageEvent);
      });
    },
  };

  const g = globalThis as unknown as { self?: unknown };
  hadOriginalSelf = "self" in g;
  originalSelf = g.self;
  g.self = proxy;

  // Mock the `?worker` import so worker-client constructs ShimWorker.
  vi.doMock("../worker?worker", () => ({ default: ShimWorker }));

  // Resetting the module registry forces worker-client.ts to pick up the mock
  // when it's next imported by the test, and forces ../worker to re-evaluate
  // against our `self` proxy.
  vi.resetModules();

  // Import the worker module so its `self.onmessage = ...` binding runs
  // against our proxy *now*. Without this, the first message from the test
  // would arrive before the worker has installed its handler.
  await import("../worker");
}

export function uninstallWorkerShim(): void {
  if (!installed) return;
  installed = false;
  vi.doUnmock("../worker?worker");
  const g = globalThis as unknown as { self?: unknown };
  if (hadOriginalSelf) {
    g.self = originalSelf;
  } else {
    delete g.self;
  }
  activeWorkerInstance = null;
}
