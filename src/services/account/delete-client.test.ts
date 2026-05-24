import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestDeletion, cancelDeletion } from "./delete-client";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

function makeFetchResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("requestDeletion", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /api/v1/account/request-deletion and returns deleteAfter", async () => {
    const deleteAfter = "2026-06-07T00:00:00.000Z";
    mockFetch.mockReturnValueOnce(makeFetchResponse({ deleteAfter }));

    const result = await requestDeletion();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/account/request-deletion",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.deleteAfter).toBe(deleteAfter);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ title: "Forbidden" }),
      } as Response),
    );

    await expect(requestDeletion()).rejects.toThrow("Forbidden");
  });
});

describe("cancelDeletion", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("POSTs to /api/v1/account/cancel-deletion", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      } as Response),
    );

    await expect(cancelDeletion()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/account/cancel-deletion",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ title: "No pending deletion" }),
      } as Response),
    );

    await expect(cancelDeletion()).rejects.toThrow("No pending deletion");
  });
});
