// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

vi.mock("../db/database", () => ({
  db: {
    logs: {
      bulkAdd: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
    },
  },
}));

vi.mock("../stores/settings-store", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({ logLevel: "errors" })),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { db } from "../db/database";
import { useSettingsStore } from "../stores/settings-store";
import { logger } from "./log.service";

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Drain the module-level buffer between tests
  (logger as any)._flush = vi.fn();
  // Reset to errors-only by default
  vi.mocked(useSettingsStore.getState).mockReturnValue({ logLevel: "errors" } as any);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBuffer(): unknown[] {
  // Access the module-scope buffer by flushing with a spy on bulkAdd
  // Instead we expose _flush on logger and count bulkAdd calls after flushing.
  // For buffer inspection tests we rely on the bulkAdd spy after a manual flush.
  return [];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("logger — logLevel filtering", () => {
  it('does not flush debug or info when logLevel is "errors"', async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({ logLevel: "errors" } as any);
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);

    logger.debug("debug msg");
    logger.info("info msg");

    // Allow microtask queue to drain
    await Promise.resolve();

    expect(vi.mocked(db.logs.bulkAdd)).not.toHaveBeenCalled();
  });

  it('flushes error entries when logLevel is "errors"', async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({ logLevel: "errors" } as any);
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);

    logger.error("something broke");

    await Promise.resolve();
    await Promise.resolve(); // two ticks: one for queueMicrotask, one for the async flush

    expect(vi.mocked(db.logs.bulkAdd)).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(db.logs.bulkAdd).mock.calls[0][0] as unknown as Array<{
      level: string;
      message: string;
    }>;
    expect(batch[0].level).toBe("ERROR");
    expect(batch[0]).toHaveProperty("message", "something broke");
  });

  it('flushes all levels when logLevel is "all"', async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({ logLevel: "all" } as any);
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.logs.bulkAdd)).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(db.logs.bulkAdd).mock.calls[0][0] as unknown as Array<{
      level: string;
    }>;
    expect(batch.map((b) => b.level)).toEqual(["DEBUG", "INFO", "WARN", "ERROR"]);
  });
});

describe("logger — buffer overflow", () => {
  it("shifts the oldest entry when buffer exceeds MAX_BUFFER (500)", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({ logLevel: "all" } as any);
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);

    // Fill buffer with 500 entries
    for (let i = 0; i < 500; i++) {
      logger.info(`entry-${i}`);
    }

    // Drain so the 500 entries are flushed and buffer is empty
    await Promise.resolve();
    await Promise.resolve();

    vi.clearAllMocks();

    // Add one more beyond limit (buffer will be empty at this point, so this just adds normally)
    // To really test the shift: fill again to 500 without flushing, then add one more
    // We need a way to block flushing. We do this by making bulkAdd never resolve.
    vi.mocked(db.logs.bulkAdd).mockReturnValue(new Promise(() => {}) as any);

    for (let i = 0; i < 500; i++) {
      logger.info(`fill-${i}`);
    }
    // Now buffer is full (500). Add one more — should shift fill-0 and add the new one.
    logger.info("overflow-entry");

    // Verify by forcing a flush with a spy
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);
    await logger._flush();

    const calls = vi.mocked(db.logs.bulkAdd).mock.calls;
    // The last resolved bulkAdd call holds what was in the buffer after the overflow
    const lastBatch = calls[calls.length - 1][0] as unknown as Array<{ message: string }>;
    expect(lastBatch.length).toBe(500);
    expect(lastBatch[0].message).toBe("fill-1"); // fill-0 was shifted out
    expect(lastBatch[lastBatch.length - 1].message).toBe("overflow-entry");
  });
});

describe("logger.trimOldLogs", () => {
  it("deletes logs with timestamp below the 24h cutoff", async () => {
    const deleteMock = vi.fn().mockResolvedValue(3) as any;
    const belowMock = vi.fn().mockReturnValue({ delete: deleteMock });
    vi.mocked(db.logs.where).mockReturnValue({ below: belowMock } as any);

    const deleted = await logger.trimOldLogs();

    expect(vi.mocked(db.logs.where)).toHaveBeenCalledWith("timestamp");
    expect(deleted).toBe(3);

    // Verify the cutoff is approximately 24h ago
    const cutoffArg: string = belowMock.mock.calls[0][0];
    const cutoffMs = new Date(cutoffArg).getTime();
    const expectedMs = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(2000);
  });

  it("returns 0 when no logs are old enough to delete", async () => {
    const deleteMock = vi.fn().mockResolvedValue(0) as any;
    const belowMock = vi.fn().mockReturnValue({ delete: deleteMock });
    vi.mocked(db.logs.where).mockReturnValue({ below: belowMock } as any);

    const deleted = await logger.trimOldLogs();
    expect(deleted).toBe(0);
  });
});

describe("logger.exportLogs", () => {
  it('calls db.logs.orderBy("timestamp") to fetch all logs', async () => {
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);
    const deleteMock = vi.fn().mockResolvedValue(0) as any;
    const belowMock = vi.fn().mockReturnValue({ delete: deleteMock });
    vi.mocked(db.logs.where).mockReturnValue({ below: belowMock } as any);
    vi.mocked(db.logs.orderBy).mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) } as any);

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickMock = vi.fn();
    const anchor = { href: "", download: "", click: clickMock } as unknown as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    vi.spyOn(document.body, "appendChild").mockImplementation(() => anchor);
    vi.spyOn(document.body, "removeChild").mockImplementation(() => anchor);

    await logger.exportLogs();

    expect(vi.mocked(db.logs.orderBy)).toHaveBeenCalledWith("timestamp");
    expect(document.createElement).toHaveBeenCalledWith("a");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalledTimes(1);
  });

  it("sets a .txt download filename with todays date", async () => {
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);
    const deleteMock = vi.fn().mockResolvedValue(0) as any;
    const belowMock = vi.fn().mockReturnValue({ delete: deleteMock });
    vi.mocked(db.logs.where).mockReturnValue({ below: belowMock } as any);
    vi.mocked(db.logs.orderBy).mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) } as any);

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickMock = vi.fn();
    const anchor = { href: "", download: "", click: clickMock } as unknown as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    vi.spyOn(document.body, "appendChild").mockImplementation(() => anchor);
    vi.spyOn(document.body, "removeChild").mockImplementation(() => anchor);

    await logger.exportLogs();

    const today = new Date().toISOString().slice(0, 10);
    expect(anchor.download).toBe(`expenses-logs-${today}.txt`);
  });

  it("formats each log line correctly", async () => {
    vi.mocked(db.logs.bulkAdd).mockResolvedValue(undefined as any);
    const deleteMock = vi.fn().mockResolvedValue(0) as any;
    const belowMock = vi.fn().mockReturnValue({ delete: deleteMock });
    vi.mocked(db.logs.where).mockReturnValue({ below: belowMock } as any);

    const sampleLog = {
      id: 1,
      timestamp: "2026-04-16T10:00:00.000Z",
      level: "INFO",
      message: "test message",
      context: { key: "value" },
    };
    vi.mocked(db.logs.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([sampleLog]),
    } as any);

    let capturedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b: Blob | MediaSource) => {
      capturedBlob = b as Blob;
      return "blob:fake";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchor = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    vi.spyOn(document.body, "appendChild").mockImplementation(() => anchor);
    vi.spyOn(document.body, "removeChild").mockImplementation(() => anchor);

    await logger.exportLogs();

    const text = await capturedBlob!.text();
    expect(text).toBe('[2026-04-16T10:00:00.000Z] INFO test message {"key":"value"}');
  });
});
