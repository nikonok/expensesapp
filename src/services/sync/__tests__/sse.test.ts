// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("@/services/log.service", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Minimal EventSource stub ──────────────────────────────────────────────────
// jsdom doesn't include EventSource; we provide a controllable fake.

interface FakeESInstance {
  url: string;
  withCredentials: boolean;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  close: () => void;
  // listeners registered via addEventListener
  _listeners: Map<string, ((e: MessageEvent) => void)[]>;
  addEventListener: (type: string, handler: (e: MessageEvent) => void) => void;
  /** helpers to simulate server-sent events in tests */
  simulateOpen: () => void;
  simulateMessage: (type: string, data: unknown) => void;
  simulateError: () => void;
}

let lastES: FakeESInstance | null = null;
const allES: FakeESInstance[] = [];

class FakeEventSource implements FakeESInstance {
  url: string;
  withCredentials: boolean;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  _listeners = new Map<string, ((e: MessageEvent) => void)[]>();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    lastES = this;
    allES.push(this);
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type)!.push(handler);
  }

  close() {
    // no-op in stub
  }

  simulateOpen() {
    this.onopen?.(new Event("open"));
  }

  simulateMessage(type: string, data: unknown) {
    const msg = new MessageEvent(type, { data: JSON.stringify(data) });
    const handlers = this._listeners.get(type) ?? [];
    for (const h of handlers) h(msg);
    this.onmessage?.(msg);
  }

  simulateError() {
    this.onerror?.(new Event("error"));
  }
}

// Install the fake before importing the module under test.
vi.stubGlobal("EventSource", FakeEventSource);

import { connectSSE } from "../sse";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  allES.length = 0;
  lastES = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("connectSSE — basic connection", () => {
  it("opens EventSource at the sync/live endpoint", () => {
    const handle = connectSSE({ onEvent: vi.fn() });
    expect(lastES?.url).toBe("/api/v1/sync/live");
    handle.disconnect();
  });

  it("calls onOpen when EventSource opens", () => {
    const onOpen = vi.fn();
    const handle = connectSSE({ onEvent: vi.fn(), onOpen });
    lastES?.simulateOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
    handle.disconnect();
  });
});

describe("connectSSE — event dispatch", () => {
  it("calls onEvent with parsed payload for record.changed", () => {
    const onEvent = vi.fn();
    const handle = connectSSE({ onEvent });
    lastES?.simulateOpen();
    lastES?.simulateMessage("record.changed", {
      seq: 1,
      recordId: "rec-001",
      recordType: "transaction",
      version: 2,
    });
    expect(onEvent).toHaveBeenCalledWith("record.changed", {
      seq: 1,
      recordId: "rec-001",
      recordType: "transaction",
      version: 2,
    });
    handle.disconnect();
  });

  it("calls onEvent for device.joined", () => {
    const onEvent = vi.fn();
    const handle = connectSSE({ onEvent });
    lastES?.simulateOpen();
    lastES?.simulateMessage("device.joined", {
      deviceId: "dev-001",
      label: "Android (2026-05-23)",
      createdAt: "2026-05-23T10:00:00Z",
      pubKey: "AAAA",
    });
    expect(onEvent).toHaveBeenCalledWith(
      "device.joined",
      expect.objectContaining({ deviceId: "dev-001" }),
    );
    handle.disconnect();
  });
});

describe("connectSSE — seq dedup", () => {
  it("drops duplicate record.changed events with same or lower seq", () => {
    const onEvent = vi.fn();
    const handle = connectSSE({ onEvent });
    lastES?.simulateOpen();

    const payload = { seq: 5, recordId: "rec-001", recordType: "transaction", version: 1 };
    lastES?.simulateMessage("record.changed", payload);
    lastES?.simulateMessage("record.changed", payload); // duplicate seq
    lastES?.simulateMessage("record.changed", { ...payload, seq: 3 }); // older seq

    // Only the first event should pass through.
    expect(onEvent).toHaveBeenCalledTimes(1);
    handle.disconnect();
  });

  it("allows record.changed events with increasing seq", () => {
    const onEvent = vi.fn();
    const handle = connectSSE({ onEvent });
    lastES?.simulateOpen();

    lastES?.simulateMessage("record.changed", {
      seq: 1,
      recordId: "rec-001",
      recordType: "t",
      version: 1,
    });
    lastES?.simulateMessage("record.changed", {
      seq: 2,
      recordId: "rec-001",
      recordType: "t",
      version: 2,
    });
    lastES?.simulateMessage("record.changed", {
      seq: 3,
      recordId: "rec-001",
      recordType: "t",
      version: 3,
    });

    expect(onEvent).toHaveBeenCalledTimes(3);
    handle.disconnect();
  });
});

describe("connectSSE — reconnect after error", () => {
  it("reconnects after error with backoff", () => {
    const onError = vi.fn();
    const handle = connectSSE({ onEvent: vi.fn(), onError });

    const firstES = lastES!;
    firstES.simulateError();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(allES).toHaveLength(1); // not reconnected yet

    // Advance past first backoff (500ms).
    vi.advanceTimersByTime(600);
    expect(allES).toHaveLength(2); // second EventSource created

    handle.disconnect();
  });

  it("resets reconnect attempt counter after successful open", () => {
    const handle = connectSSE({ onEvent: vi.fn() });

    // Cause one error, wait for reconnect, then open successfully.
    lastES!.simulateError();
    vi.advanceTimersByTime(600);
    const secondES = lastES!;
    secondES.simulateOpen(); // successful open resets counter

    // Cause another error — should use first-slot backoff again (500ms).
    secondES.simulateError();
    vi.advanceTimersByTime(600);
    expect(allES).toHaveLength(3);

    handle.disconnect();
  });
});

describe("connectSSE — heartbeat loss", () => {
  it("logs warning after 60s of silence", async () => {
    const { logger } = await import("@/services/log.service");
    const handle = connectSSE({ onEvent: vi.fn() });
    lastES?.simulateOpen();

    vi.advanceTimersByTime(61_000);

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("sse.heartbeat.lost"),
    );
    handle.disconnect();
  });
});
