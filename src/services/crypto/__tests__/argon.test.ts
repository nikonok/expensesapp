import { describe, it, expect } from "vitest";
import { deriveRecoveryKey } from "../argon-init";

// These run the REAL Argon2id KDF (libsodium crypto_pwhash, 64 MiB / t=3) —
// each derivation takes a noticeable fraction of a second by design.
describe("deriveRecoveryKey", () => {
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

  it("matches the pinned Argon2id reference vector", async () => {
    // Pinned output for phrase+familyId below, independently computed with Go's
    // golang.org/x/crypto/argon2 IDKey(pass, hkdfSalt, t=3, m=65536 KiB, p=1,
    // len=32). Guards the frozen KDF parameters AND the HKDF salt derivation:
    // any change to either breaks all existing recovery envelopes, so this
    // test failing means STOP — do not update the vector, revert the change.
    const phrase =
      "legal winner thank year wave sausage worth useful legal winner thank yellow legal winner thank year wave sausage worth useful legal winner thank yes";
    const familyId = "01890000-aaaa-7bbb-8ccc-0123456789ab";
    const key = await deriveRecoveryKey(phrase, familyId);
    const hex = Array.from(key)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe("5cfb74bd05d874187d44945c41938ce6ede3612e029184a322ef4112e3e1924e");
  });
});
