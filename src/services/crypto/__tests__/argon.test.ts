import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Argon2BrowserHashOptions } from "argon2-browser";

// argon2-browser loads WASM via fetch() at module init time which fails in
// Vitest's Node environment (Emscripten env-detection picks browser path; no
// valid base URL for relative fetch in test runners).
// Argon2 WASM only runs in browser-like environments; Phase 2.demo exercises the full path.
vi.mock("argon2-browser", () => {
  return {
    hash: vi.fn((params: Argon2BrowserHashOptions) => {
      // Deterministic fake: XOR phrase bytes with salt bytes → hashLen-byte output.
      // Sufficient to verify determinism and familyId isolation in unit tests.
      const passBytes = new TextEncoder().encode(
        params.pass instanceof Uint8Array
          ? new TextDecoder().decode(params.pass)
          : (params.pass as string),
      );
      const salt =
        params.salt instanceof Uint8Array
          ? params.salt
          : new TextEncoder().encode(params.salt as string);
      const hashLen = params.hashLen ?? 24;
      const hash = new Uint8Array(hashLen);
      for (let i = 0; i < hashLen; i++) {
        hash[i] = (passBytes[i % passBytes.length] ?? 0) ^ (salt[i % salt.length] ?? 0);
      }
      return Promise.resolve({ hash, hashHex: "", encoded: "" });
    }),
    ArgonType: { Argon2d: 0, Argon2i: 1, Argon2id: 2 },
  };
});

import { deriveRecoveryKey } from "../argon-init";
import { hash as argonHash } from "argon2-browser";

describe("deriveRecoveryKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces a deterministic 32-byte key for fixed input", async () => {
    const phrase =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const familyId = "00000000-0000-7000-8000-000000000001";
    const k1 = await deriveRecoveryKey(phrase, familyId);
    const k2 = await deriveRecoveryKey(phrase, familyId);
    expect(k1.length).toBe(32);
    expect(Array.from(k1)).toEqual(Array.from(k2));
  });

  it("differs across familyIds", async () => {
    const phrase =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const k1 = await deriveRecoveryKey(phrase, "00000000-0000-7000-8000-000000000001");
    const k2 = await deriveRecoveryKey(phrase, "00000000-0000-7000-8000-000000000002");
    expect(Array.from(k1)).not.toEqual(Array.from(k2));
  });

  it("calls hash with Argon2id type=2 and correct parameters", async () => {
    const hashMock = argonHash as ReturnType<typeof vi.fn>;
    await deriveRecoveryKey(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      "00000000-0000-7000-8000-000000000001",
    );
    expect(hashMock).toHaveBeenCalledOnce();
    const callParams = hashMock.mock.calls[0][0] as Argon2BrowserHashOptions;
    expect(callParams.type).toBe(2); // Argon2id
    expect(callParams.mem).toBe(65536); // 64 MiB in KiB
    expect(callParams.time).toBe(3);
    expect(callParams.hashLen).toBe(32);
    expect(callParams.parallelism).toBe(1);
  });
});
