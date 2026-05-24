import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and logger before importing the module under test
vi.mock("@/db/database", () => ({
  db: {
    logs: {
      orderBy: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            timestamp: "2026-05-24T10:00:00.000Z",
            level: "INFO",
            message: "test log",
            context: null,
          },
        ]),
      }),
    },
  },
}));

vi.mock("@/services/log.service", () => ({
  logger: {
    _flush: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeOkResponse(status = 204) {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve(undefined),
  } as Response);
}

import { sendLogsToSupport } from "./logs-client";

describe("sendLogsToSupport", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("flushes logs and POSTs to /api/v1/logs/send with userConsent: true", async () => {
    mockFetch.mockReturnValueOnce(makeOkResponse());

    await sendLogsToSupport();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/logs/send",
      expect.objectContaining({ method: "POST" }),
    );

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body as string);
    expect(body.userConsent).toBe(true);
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs[0]).toContain("INFO");
    expect(body.logs[0]).toContain("test log");
  });

  it("throws when the API returns an error", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ title: "Internal server error" }),
      } as Response),
    );

    await expect(sendLogsToSupport()).rejects.toThrow("Internal server error");
  });
});
