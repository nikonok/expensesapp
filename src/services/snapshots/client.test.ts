// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetch ─────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

function okResponse(body: unknown = {}, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSnapshots", () => {
  it("returns snapshots array from { snapshots: [...] } envelope", async () => {
    const snapshots = [
      {
        snapshotId: "snap-1",
        date: "2025-05-01",
        createdAt: "2025-05-01T02:00:00Z",
        expiresAt: "2025-06-01T02:00:00Z",
      },
    ];
    mockFetch.mockResolvedValueOnce(okResponse({ snapshots }));
    const { listSnapshots } = await import("./client");

    const result = await listSnapshots();

    expect(result).toHaveLength(1);
    expect(result[0].snapshotId).toBe("snap-1");
    expect(result[0].date).toBe("2025-05-01");
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/snapshots");
  });

  it("returns snapshots when server returns a plain array", async () => {
    const snapshots = [
      {
        snapshotId: "snap-2",
        date: "2025-05-02",
        createdAt: "2025-05-02T02:00:00Z",
        expiresAt: "2025-06-02T02:00:00Z",
      },
    ];
    mockFetch.mockResolvedValueOnce(okResponse(snapshots));
    const { listSnapshots } = await import("./client");

    const result = await listSnapshots();
    expect(result).toHaveLength(1);
    expect(result[0].snapshotId).toBe("snap-2");
  });

  it("returns empty array when snapshots key is missing", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    const { listSnapshots } = await import("./client");

    const result = await listSnapshots();
    expect(result).toEqual([]);
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Unauthorized" }, 401));
    const { listSnapshots } = await import("./client");

    await expect(listSnapshots()).rejects.toThrow();
  });
});

describe("restoreSnapshot", () => {
  it("POSTs to the correct endpoint with confirm=true", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ newCursor: "cursor-abc" }));
    const { restoreSnapshot } = await import("./client");

    const result = await restoreSnapshot("2025-05-01", true);

    expect(result.newCursor).toBe("cursor-abc");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/snapshots/2025-05-01/restore?confirm=true");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("POSTs with confirm=false for dry-run", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ newCursor: "cursor-xyz" }));
    const { restoreSnapshot } = await import("./client");

    await restoreSnapshot("2025-04-15", false);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/snapshots/2025-04-15/restore?confirm=false");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Not Found" }, 404));
    const { restoreSnapshot } = await import("./client");

    await expect(restoreSnapshot("2025-01-01", true)).rejects.toThrow();
  });
});
