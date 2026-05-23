// @vitest-environment node

import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock the crypto worker module (Web Workers are not available in Node tests).
vi.mock("../crypto/worker-client", () => ({
  cryptoWorker: {
    generateDeviceKeypair: vi.fn(async () => ({
      publicKey: new Uint8Array(32).fill(1),
      privateKey: new Uint8Array(32).fill(2),
    })),
    wrapKeyForDevice: vi.fn(async () => new Uint8Array(80).fill(3)),
    wrapRecoveryEnvelope: vi.fn(async () => new Uint8Array(57).fill(4)),
    wrapPhraseForReveal: vi.fn(async () => new Uint8Array(57).fill(5)),
  },
}));

// Mock fetch for POST /api/v1/family/init
const mockFetch = vi.fn(
  async (_url: string, _init: RequestInit) => new Response(JSON.stringify({}), { status: 200 }),
);
globalThis.fetch = mockFetch as typeof globalThis.fetch;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("initFamilyAndShowPhrase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
  });

  it("returns a 24-word phrase and a valid familyId", async () => {
    const { initFamilyAndShowPhrase } = await import("./init");
    const result = await initFamilyAndShowPhrase({
      devicePubKey: new Uint8Array(32).fill(1),
      devicePrivKey: new Uint8Array(32).fill(2),
    });

    expect(result.phrase.split(" ")).toHaveLength(24);
    expect(result.familyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("calls POST /api/v1/family/init with correct body shape", async () => {
    const { initFamilyAndShowPhrase } = await import("./init");
    await initFamilyAndShowPhrase({
      devicePubKey: new Uint8Array(32).fill(1),
      devicePrivKey: new Uint8Array(32).fill(2),
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/family/init");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string) as {
      familyId: string;
      deviceEnvelope: string;
      recovery: { wrap: string; phraseCt: string; salt: string };
    };

    // familyId must be a v7 UUID
    expect(body.familyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // deviceEnvelope is base64url of 80-byte mock
    expect(typeof body.deviceEnvelope).toBe("string");
    expect(body.deviceEnvelope.length).toBeGreaterThan(0);

    // recovery has all three fields
    expect(typeof body.recovery.wrap).toBe("string");
    expect(typeof body.recovery.phraseCt).toBe("string");
    expect(typeof body.recovery.salt).toBe("string");

    // salt is base64url of 16 bytes → 22 chars (no padding)
    expect(body.recovery.salt.length).toBe(22);
  });

  it("persists familyKey and device keys to IndexedDB cipherKeys table", async () => {
    // Clear previous module cache so fresh db is used.
    const { initFamilyAndShowPhrase } = await import("./init");
    await initFamilyAndShowPhrase({
      devicePubKey: new Uint8Array(32).fill(1),
      devicePrivKey: new Uint8Array(32).fill(2),
    });

    const { db } = await import("@/db/database");
    const keys = await db.cipherKeys.toArray();
    const names = keys.map((k) => k.name);
    expect(names).toContain("familyKey");
    expect(names).toContain("devicePrivKey");
    expect(names).toContain("devicePubKey");
  });

  it("throws when POST /api/v1/family/init returns an error", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Conflict" }), { status: 409 }),
    );

    const { initFamilyAndShowPhrase } = await import("./init");
    await expect(
      initFamilyAndShowPhrase({
        devicePubKey: new Uint8Array(32).fill(1),
        devicePrivKey: new Uint8Array(32).fill(2),
      }),
    ).rejects.toThrow();
  });
});
