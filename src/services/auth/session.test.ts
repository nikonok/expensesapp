import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock apiFetch — session.ts is the only module under test.
vi.mock("./client", () => ({
  apiFetch: vi.fn(),
}));

// Mock signInWithGoogle
vi.mock("./google", () => ({
  signInWithGoogle: vi.fn(),
}));

// Mock the crypto worker client — session.ts dynamic-imports it.
const mockGetDevicePublicKey = vi.fn();
const mockGenerateAndPersistDeviceKey = vi.fn();
vi.mock("../crypto/worker-client", () => ({
  cryptoWorker: {
    getDevicePublicKey: (...args: unknown[]) => mockGetDevicePublicKey(...args),
    generateAndPersistDeviceKey: (...args: unknown[]) => mockGenerateAndPersistDeviceKey(...args),
  },
}));

import { apiFetch } from "./client";
import { signInWithGoogle } from "./google";
import { useAuthStore } from "./session";

const mockFetch = apiFetch as ReturnType<typeof vi.fn>;
const mockSignInWithGoogle = signInWithGoogle as ReturnType<typeof vi.fn>;

function resetStore() {
  useAuthStore.setState({
    user: null,
    device: null,
    isSignedIn: false,
    isSigningIn: false,
    sessionResolved: false,
    error: null,
    errorStatus: null,
    needsFamilyInit: false,
    awaitingEnvelope: false,
    family: null,
    pendingDevicePubKey: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
  resetStore();
  mockSignInWithGoogle.mockResolvedValue({ idToken: "id-token" });
});

describe("useAuthStore.signIn — device key reuse (B: strand-on-resign-in fix)", () => {
  it("reuses an existing worker-cached device public key instead of generating a new one", async () => {
    const existingKey = new Uint8Array([1, 2, 3]);
    mockGetDevicePublicKey.mockResolvedValue(existingKey);
    mockFetch.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", displayName: "A", isAdmin: false, isRoot: false },
      device: { id: "d1", label: "Test" },
      awaitingEnvelope: false,
    });

    await useAuthStore.getState().signIn();

    expect(mockGenerateAndPersistDeviceKey).not.toHaveBeenCalled();
    expect(useAuthStore.getState().pendingDevicePubKey).toBe(existingKey);
    expect(useAuthStore.getState().isSignedIn).toBe(true);
    expect(useAuthStore.getState().sessionResolved).toBe(true);
  });

  it("generates a fresh device key only when no cached key is available", async () => {
    const freshKey = new Uint8Array([9, 9, 9]);
    mockGetDevicePublicKey.mockResolvedValue(null);
    mockGenerateAndPersistDeviceKey.mockResolvedValue(freshKey);
    mockFetch.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", displayName: "A", isAdmin: false, isRoot: false },
      device: { id: "d1", label: "Test" },
      awaitingEnvelope: false,
    });

    await useAuthStore.getState().signIn();

    expect(mockGenerateAndPersistDeviceKey).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().pendingDevicePubKey).toBe(freshKey);
  });
});

describe("useAuthStore.signIn — errorStatus (allowlist-rejection branching)", () => {
  it("captures a 403 ApiError's status so callers can show an allowlist-specific message", async () => {
    mockGetDevicePublicKey.mockResolvedValue(new Uint8Array([1]));
    const err = new Error("email-not-allowed") as Error & { status: number };
    err.status = 403;
    mockFetch.mockRejectedValue(err);

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().isSignedIn).toBe(false);
    expect(useAuthStore.getState().errorStatus).toBe(403);
  });

  it("clears a previous errorStatus at the start of a new sign-in attempt", async () => {
    useAuthStore.setState({ errorStatus: 403, error: "stale" });
    mockGetDevicePublicKey.mockResolvedValue(new Uint8Array([1]));
    mockFetch.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", displayName: "A", isAdmin: false, isRoot: false },
      device: { id: "d1", label: "Test" },
      awaitingEnvelope: false,
    });

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().errorStatus).toBeNull();
  });
});

describe("useAuthStore.signOut — clears local state before the network call", () => {
  it("has already cleared isSignedIn by the time the signout request is in flight", async () => {
    useAuthStore.setState({ isSignedIn: true, user: { id: "u1" } as never });

    let isSignedInDuringFetch: boolean | null = null;
    mockFetch.mockImplementation(async () => {
      isSignedInDuringFetch = useAuthStore.getState().isSignedIn;
      throw new Error("401");
    });

    await useAuthStore.getState().signOut();

    expect(isSignedInDuringFetch).toBe(false);
    expect(useAuthStore.getState().isSignedIn).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe("useAuthStore.refreshMe — session restore", () => {
  it("hydrates user/device/awaitingEnvelope/family and marks the session resolved", async () => {
    mockFetch.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", displayName: "A", isAdmin: false, isRoot: false },
      device: { id: "d1", label: "Test" },
      family: { id: "fam1", role: "member" },
      awaitingEnvelope: true,
    });

    await useAuthStore.getState().refreshMe();

    const state = useAuthStore.getState();
    expect(state.isSignedIn).toBe(true);
    expect(state.awaitingEnvelope).toBe(true);
    expect(state.family).toEqual({ id: "fam1", role: "member" });
    expect(state.sessionResolved).toBe(true);
  });

  it("marks the session resolved (signed out) when there is no valid session", async () => {
    mockFetch.mockRejectedValue(new Error("401"));

    await useAuthStore.getState().refreshMe();

    const state = useAuthStore.getState();
    expect(state.isSignedIn).toBe(false);
    expect(state.family).toBeNull();
    expect(state.sessionResolved).toBe(true);
  });
});
