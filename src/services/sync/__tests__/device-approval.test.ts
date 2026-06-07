// @vitest-environment node
//
// B5a — explicit device approval tests.
//
// Verifies that:
//   (a) the SSE device.joined branch never wraps the familyKey on its own
//       (the malicious-server auto-approve path is gone);
//   (b) approveDevice wraps + POSTs only when the user clicks Approve;
//   (c) rejectDevice calls the revoke endpoint and never wraps.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

const wrapStoredFamilyKeyForDevice = vi.fn(async () => "envelope-b64u");
const fingerprintPublicKey = vi.fn(async () => "ABCDEFGHJKLMN");

vi.mock("@/services/crypto/worker-client", () => ({
  cryptoWorker: {
    wrapStoredFamilyKeyForDevice,
    fingerprintPublicKey,
    encryptRecordWithStoredKey: vi.fn(),
    decryptRecordWithStoredKey: vi.fn(),
    unwrapAndPersistFamilyKey: vi.fn(),
    clearAllStoredKeys: vi.fn(),
  },
}));

const apiFetch = vi.fn(async () => undefined);
vi.mock("@/services/auth/client", () => ({ apiFetch }));

const setPendingDeviceJoin = vi.fn();
vi.mock("@/stores/device-join-store", () => ({
  useDeviceJoinStore: {
    getState: () => ({ setPendingDeviceJoin }),
  },
}));

vi.mock("@/services/auth/session", () => ({
  useAuthStore: {
    getState: () => ({
      signOut: vi.fn(),
      clearAwaitingEnvelope: vi.fn(),
    }),
  },
}));

// Capture the SSE handler so the test can fire device.joined directly.
let capturedOpts: Parameters<typeof import("../sse").connectSSE>[0] | null = null;
vi.mock("../sse", () => ({
  connectSSE: vi.fn((opts) => {
    capturedOpts = opts;
    return { disconnect: vi.fn() };
  }),
}));

vi.mock("../client", () => ({
  pushRecords: vi.fn(),
  pullRecords: vi.fn(),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("device.joined — no auto-approve (B5a)", () => {
  it("never wraps the familyKey from the SSE handler", async () => {
    const { startLiveSync } = await import("../engine");
    const disconnect = startLiveSync("family-001");
    expect(capturedOpts).not.toBeNull();

    capturedOpts!.onEvent("device.joined", {
      deviceId: "dev-new-001",
      label: "iPhone (2026-06-07)",
      createdAt: "2026-06-07T10:00:00Z",
      pubKey: "pub-key-b64u",
    });

    // Resolve dynamic imports + any awaited tasks scheduled by the handler.
    await new Promise((r) => setTimeout(r, 50));

    // The store IS updated so the UI can show the banner …
    expect(setPendingDeviceJoin).toHaveBeenCalledTimes(1);
    expect(setPendingDeviceJoin.mock.calls[0][0]).toMatchObject({
      deviceId: "dev-new-001",
      pubKey: "pub-key-b64u",
      fingerprint: "ABCDEFGHJKLMN",
    });

    // … but nothing wrapped the familyKey, and no envelope was POSTed.
    expect(wrapStoredFamilyKeyForDevice).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();

    disconnect();
  });

  it("stores fingerprint=null gracefully if the worker computation throws", async () => {
    fingerprintPublicKey.mockRejectedValueOnce(new Error("worker boom"));
    const { startLiveSync } = await import("../engine");
    const disconnect = startLiveSync("family-002");

    capturedOpts!.onEvent("device.joined", {
      deviceId: "dev-002",
      label: "Linux",
      createdAt: "2026-06-07T10:00:00Z",
      pubKey: "pub-key-b64u",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(setPendingDeviceJoin).toHaveBeenCalledTimes(1);
    expect(setPendingDeviceJoin.mock.calls[0][0].fingerprint).toBeNull();
    expect(wrapStoredFamilyKeyForDevice).not.toHaveBeenCalled();

    disconnect();
  });
});

describe("approveDevice", () => {
  it("wraps the stored familyKey and POSTs the envelope", async () => {
    const { approveDevice } = await import("../engine");

    await approveDevice("dev-approve-001", "pub-key-b64u");

    expect(wrapStoredFamilyKeyForDevice).toHaveBeenCalledWith("pub-key-b64u");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/family/devices/dev-approve-001/envelope",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("falls back to GET /api/v1/me/devices/{id} when no pubkey is provided", async () => {
    apiFetch.mockResolvedValueOnce({ pubKey: "fallback-pub-key-b64u" } as never);
    const { approveDevice } = await import("../engine");

    await approveDevice("dev-no-pub", null);

    // First call resolves the pubkey, second posts the envelope.
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/me/devices/dev-no-pub");
    expect(wrapStoredFamilyKeyForDevice).toHaveBeenCalledWith("fallback-pub-key-b64u");
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/v1/family/devices/dev-no-pub/envelope",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("rejectDevice", () => {
  it("revokes via the existing /revoke endpoint and never wraps the familyKey", async () => {
    const { rejectDevice } = await import("../engine");

    await rejectDevice("dev-bad-001");

    expect(wrapStoredFamilyKeyForDevice).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/me/devices/dev-bad-001/revoke",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
