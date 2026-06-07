import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth/client", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../crypto/worker-client", () => ({
  cryptoWorker: {
    unwrapStoredPhraseForReveal: vi.fn(),
  },
}));

import { apiFetch } from "../auth/client";
import { cryptoWorker } from "../crypto/worker-client";
import { revealRecoveryPhrase } from "./recovery-client";

const mockFetch = apiFetch as ReturnType<typeof vi.fn>;
const mockWorker = cryptoWorker.unwrapStoredPhraseForReveal as ReturnType<typeof vi.fn>;

// Encode a string as base64url (no padding) to simulate what the server returns.
function toBase64Url(str: string): string {
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("revealRecoveryPhrase", () => {
  it("calls reveal endpoint, decodes ciphertext, and delegates to worker", async () => {
    const fakeCt = "fake-ct-bytes";
    const phraseCtB64u = toBase64Url(fakeCt);

    mockFetch.mockResolvedValueOnce({
      phraseCt: phraseCtB64u,
      saltB64: "salt",
      familyId: "family-123",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    mockWorker.mockResolvedValueOnce("word1 word2 word3");

    const phrase = await revealRecoveryPhrase("grant-abc", "family-123");

    expect(mockFetch).toHaveBeenCalledWith("/api/v1/account/recovery/reveal", {
      method: "POST",
      headers: { "X-Reauth-Grant": "grant-abc" },
    });

    // Worker should receive decoded Uint8Array, the familyId, and createdAt.
    expect(mockWorker).toHaveBeenCalledTimes(1);
    const [phraseCt, familyId, createdAt] = mockWorker.mock.calls[0];
    expect(phraseCt).toBeInstanceOf(Uint8Array);
    expect(familyId).toBe("family-123");
    expect(createdAt).toBe("2024-01-01T00:00:00.000Z");

    expect(phrase).toBe("word1 word2 word3");
  });

  it("passes empty createdAt to worker when server omits it (pre-B9 envelope)", async () => {
    mockFetch.mockResolvedValueOnce({ phraseCt: toBase64Url("ct"), saltB64: "salt" });
    mockWorker.mockResolvedValueOnce("word1 word2");

    await revealRecoveryPhrase("grant-abc", "family-123");

    const [, , createdAt] = mockWorker.mock.calls[0];
    expect(createdAt).toBe("");
  });

  it("propagates network errors from the reveal endpoint", async () => {
    mockFetch.mockRejectedValueOnce(new Error("401 Unauthorized"));

    await expect(revealRecoveryPhrase("bad-grant", "family-123")).rejects.toThrow(
      "401 Unauthorized",
    );
  });

  it("propagates errors from the crypto worker", async () => {
    mockFetch.mockResolvedValueOnce({ phraseCt: toBase64Url("ct"), saltB64: "s" });
    mockWorker.mockRejectedValueOnce(new Error("NoStoredFamilyKey: missing key"));

    await expect(revealRecoveryPhrase("grant-abc", "family-123")).rejects.toThrow(
      "NoStoredFamilyKey",
    );
  });
});
