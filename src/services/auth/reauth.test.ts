import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock apiFetch
vi.mock("./client", () => ({
  apiFetch: vi.fn(),
}));

// Mock signInWithGoogle
vi.mock("./google", () => ({
  signInWithGoogle: vi.fn(),
}));

import { apiFetch } from "./client";
import { signInWithGoogle } from "./google";
import { requestReauthGrant } from "./reauth";

const mockFetch = apiFetch as ReturnType<typeof vi.fn>;
const mockSignIn = signInWithGoogle as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Provide VITE_GOOGLE_OAUTH_CLIENT_ID
  vi.stubEnv("VITE_GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
});

describe("requestReauthGrant", () => {
  it("calls challenge, signs in with the returned nonce, and calls verify", async () => {
    mockFetch
      .mockResolvedValueOnce({ nonce: "abc123" }) // challenge
      .mockResolvedValueOnce({ grantId: "grant-xyz", expiresAt: "2099-01-01T00:00:00Z" }); // verify

    mockSignIn.mockResolvedValueOnce({ idToken: "id-token-val" });

    const grant = await requestReauthGrant();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/v1/reauth/challenge", { method: "POST" });
    expect(mockSignIn).toHaveBeenCalledWith({
      clientId: "test-client-id",
      nonce: "abc123",
    });
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/v1/reauth/verify", {
      method: "POST",
      body: JSON.stringify({ nonce: "abc123", idToken: "id-token-val" }),
    });

    expect(grant).toEqual({ grantId: "grant-xyz", expiresAt: "2099-01-01T00:00:00Z" });
  });

  it("propagates an error from the challenge endpoint", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    await expect(requestReauthGrant()).rejects.toThrow("network error");
  });

  it("propagates an error if Google sign-in is dismissed", async () => {
    mockFetch.mockResolvedValueOnce({ nonce: "abc123" });
    mockSignIn.mockRejectedValueOnce(new Error("Google sign-in dismissed"));

    await expect(requestReauthGrant()).rejects.toThrow("Google sign-in dismissed");
  });

  it("throws if VITE_GOOGLE_OAUTH_CLIENT_ID is not set", async () => {
    vi.stubEnv("VITE_GOOGLE_OAUTH_CLIENT_ID", "");
    mockFetch.mockResolvedValueOnce({ nonce: "abc123" });

    await expect(requestReauthGrant()).rejects.toThrow("VITE_GOOGLE_OAUTH_CLIENT_ID not set");
  });
});
