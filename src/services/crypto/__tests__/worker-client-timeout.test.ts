// @vitest-environment node
//
// worker-client.ts must not pend forever if the crypto worker hangs (never
// replies, never fires onerror). These tests mock the `?worker` import with
// hand-rolled Worker-shaped stubs (rather than the real worker-shim used by
// worker.test.ts / worker.crypto.test.ts) so we can control exactly when — or
// whether — a reply arrives, and drive fake timers past the RPC timeout.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface StubWorkerInstance {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

describe("cryptoWorker RPC timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("../worker?worker");
    vi.resetModules();
  });

  it("rejects a hung RPC after the default timeout instead of pending forever", async () => {
    class HangingWorker implements StubWorkerInstance {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(): void {
        // Never respond and never call onerror — simulates a worker that has
        // hung (e.g. stuck in a WASM init loop).
      }
      terminate(): void {}
    }
    vi.doMock("../worker?worker", () => ({ default: HangingWorker }));
    vi.resetModules();

    const { cryptoWorker } = await import("../worker-client");
    const promise = cryptoWorker.ping("hello");

    const assertion = expect(promise).rejects.toThrow(/timed out after 10000ms/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("resolves normally when the worker replies before the timeout fires", async () => {
    class EchoWorker implements StubWorkerInstance {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(msg: unknown): void {
        const { id, payload } = msg as { id: number; payload: string };
        queueMicrotask(() => {
          this.onmessage?.({ data: { id, ok: true, result: payload } } as MessageEvent);
        });
      }
      terminate(): void {}
    }
    vi.doMock("../worker?worker", () => ({ default: EchoWorker }));
    vi.resetModules();

    const { cryptoWorker } = await import("../worker-client");
    const promise = cryptoWorker.ping("hello");
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toBe("hello");
  });

  it("uses a longer timeout for Argon2id-backed RPCs (wrapRecoveryEnvelope)", async () => {
    class HangingWorker implements StubWorkerInstance {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(): void {}
      terminate(): void {}
    }
    vi.doMock("../worker?worker", () => ({ default: HangingWorker }));
    vi.resetModules();

    const { cryptoWorker } = await import("../worker-client");
    const promise = cryptoWorker.wrapRecoveryEnvelope(
      new Uint8Array(32),
      "phrase",
      "00000000-0000-7000-8000-000000000001",
      "2024-01-01T00:00:00.000Z",
    );

    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // Still pending well past the default (fast-RPC) 10s timeout — the
    // Argon2id-backed RPC must get the longer 60s window, not the default.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);

    const assertion = expect(promise).rejects.toThrow(/timed out after 60000ms/);
    await vi.advanceTimersByTimeAsync(50_000);
    await assertion;
  });
});
