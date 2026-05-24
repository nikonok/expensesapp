// @vitest-environment jsdom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// ── Mock factories (recreated per module reset) ───────────────────────────────

type PullSinceFn = (familyId: string, cursor: string | undefined) => Promise<unknown>;
type GetCursorFn = (familyId: string) => Promise<string | undefined>;
type GetFamilyIdFn = () => Promise<string | null>;

const mockPullSince = vi.fn<PullSinceFn>();
const mockGetCursor = vi.fn<GetCursorFn>(async () => undefined);
const mockGetLocalFamilyId = vi.fn<GetFamilyIdFn>(async () => "family-123");

vi.mock("@/services/log.service", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/stores/sync-store", () => ({
  useSyncStore: {
    getState: () => ({
      setIsSyncing: vi.fn(),
      setLastSyncAt: vi.fn(),
      setLastError: vi.fn(),
    }),
  },
}));

vi.mock("../engine", () => ({
  pullSince: (familyId: string, cursor: string | undefined) => mockPullSince(familyId, cursor),
  getCursor: (familyId: string) => mockGetCursor(familyId),
}));

vi.mock("@/services/family/active-family", () => ({
  getLocalFamilyId: () => mockGetLocalFamilyId(),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockPullSince.mockResolvedValue({ records: [], nextCursor: "c1", hasMore: false });
  // Reset module-level state so lastCatchUpAt and catchUpInProgress are clean.
  const mod = await import("../background-sync");
  mod._resetForTesting();
  // Ensure document starts as visible for timer-based tests.
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
});

afterEach(async () => {
  // Tear down any lingering listeners before resetting timers.
  const mod = await import("../background-sync");
  mod.teardownBackgroundSync();
  mod._resetForTesting();
  vi.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Advance fake time past the 30-second catch-up debounce. */
function advancePastDebounce() {
  vi.advanceTimersByTime(31_000);
}

/** Flush all pending promises (microtask queue). */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── foreground catch-up ───────────────────────────────────────────────────────

describe("setupForegroundCatchUp", () => {
  it("triggers pull when document becomes visible", async () => {
    const { setupForegroundCatchUp } = await import("../background-sync");
    setupForegroundCatchUp();

    advancePastDebounce();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.runAllTimersAsync();

    expect(mockGetLocalFamilyId).toHaveBeenCalled();
    expect(mockPullSince).toHaveBeenCalledWith("family-123", undefined);
  });

  it("does not trigger pull when document becomes hidden", async () => {
    const { setupForegroundCatchUp } = await import("../background-sync");
    setupForegroundCatchUp();

    advancePastDebounce();

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.runAllTimersAsync();

    expect(mockPullSince).not.toHaveBeenCalled();
  });

  it("debounces: second visible event within 30s is skipped", async () => {
    const { setupForegroundCatchUp } = await import("../background-sync");
    setupForegroundCatchUp();

    // Set fake time so the first event is beyond the debounce window.
    advancePastDebounce();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });

    // First event — should trigger a pull.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();
    expect(mockPullSince).toHaveBeenCalledTimes(1);

    // Second event immediately — within the 30s debounce window.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();
    expect(mockPullSince).toHaveBeenCalledTimes(1);
  });

  it("skips pull when no familyId is available", async () => {
    const { setupForegroundCatchUp } = await import("../background-sync");
    mockGetLocalFamilyId.mockResolvedValueOnce(null);
    setupForegroundCatchUp();

    advancePastDebounce();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();

    expect(mockPullSince).not.toHaveBeenCalled();
  });
});

// ── BroadcastChannel listener ─────────────────────────────────────────────────
// BroadcastChannel uses the Node.js native event loop for message delivery
// (not timers), so these tests use real timers with Date.now() mocked.

describe("setupBroadcastChannelListener", () => {
  it("triggers pull on sync-tick BroadcastChannel message", async () => {
    // Use real timers — Node BroadcastChannel delivery is native async.
    vi.useRealTimers();
    vi.clearAllMocks();
    mockPullSince.mockResolvedValue({ records: [], nextCursor: "c2", hasMore: false });

    const { setupBroadcastChannelListener, _resetForTesting } = await import("../background-sync");
    _resetForTesting();

    // Patch Date.now to return a value past the debounce window.
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    try {
      setupBroadcastChannelListener();

      const ch = new BroadcastChannel("catch-up-sync");
      ch.postMessage({ type: "sync-tick" });
      ch.close();

      // Wait for the Node.js event-loop task to deliver the message + async pull.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (mockPullSince.mock.calls.length > 0) {
            resolve();
          } else {
            setTimeout(check, 20);
          }
        };
        setTimeout(check, 20);
      });

      expect(mockPullSince).toHaveBeenCalledWith("family-123", undefined);
    } finally {
      dateSpy.mockRestore();
      const mod = await import("../background-sync");
      mod.teardownBackgroundSync();
      mod._resetForTesting();
      // Restore fake timers for the remaining tests.
      vi.useFakeTimers();
    }
  });

  it("ignores messages with unknown type", async () => {
    vi.useRealTimers();
    vi.clearAllMocks();

    const { setupBroadcastChannelListener, _resetForTesting } = await import("../background-sync");
    _resetForTesting();

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    try {
      setupBroadcastChannelListener();

      const ch = new BroadcastChannel("catch-up-sync");
      ch.postMessage({ type: "unrelated-message" });
      ch.close();

      // Allow enough time for message delivery.
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPullSince).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      const mod = await import("../background-sync");
      mod.teardownBackgroundSync();
      mod._resetForTesting();
      vi.useFakeTimers();
    }
  });
});

// ── teardown ──────────────────────────────────────────────────────────────────

describe("teardownBackgroundSync", () => {
  it("removes visibilitychange listener after teardown", async () => {
    const { setupForegroundCatchUp, teardownBackgroundSync } = await import("../background-sync");

    setupForegroundCatchUp();
    teardownBackgroundSync();

    advancePastDebounce();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();

    expect(mockPullSince).not.toHaveBeenCalled();
  });
});

// ── registerCatchUpPeriodicSync ───────────────────────────────────────────────

describe("registerCatchUpPeriodicSync", () => {
  it("no-ops when serviceWorker is unavailable", async () => {
    const { registerCatchUpPeriodicSync } = await import("../background-sync");
    const origSW = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
    await expect(registerCatchUpPeriodicSync()).resolves.toBeUndefined();
    if (origSW) {
      Object.defineProperty(navigator, "serviceWorker", origSW);
    }
  });

  it("no-ops on iOS user agent", async () => {
    const { registerCatchUpPeriodicSync } = await import("../background-sync");
    const origUA = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
      configurable: true,
    });

    const readySpy = vi.fn();
    const origSW = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: readySpy },
      configurable: true,
    });

    await registerCatchUpPeriodicSync();
    expect(readySpy).not.toHaveBeenCalled();

    if (origUA) Object.defineProperty(navigator, "userAgent", origUA);
    if (origSW) Object.defineProperty(navigator, "serviceWorker", origSW);
  });
});
