// @vitest-environment node

import { describe, it, expect } from "vitest";
import { generateDeviceKeypair, wrapKeyForDevice, unwrapKeyForDevice } from "../envelope";

function randomKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}

describe("sealed-box envelope", () => {
  it("round-trips familyKey", async () => {
    const familyKey = randomKey();
    const kp = await generateDeviceKeypair();
    const envelope = await wrapKeyForDevice(familyKey, kp.publicKey);
    const recovered = await unwrapKeyForDevice(envelope, kp.publicKey, kp.privateKey);
    expect(Array.from(recovered)).toEqual(Array.from(familyKey));
  });

  it("envelope is 80 bytes for a 32-byte payload", async () => {
    const familyKey = randomKey();
    const kp = await generateDeviceKeypair();
    const envelope = await wrapKeyForDevice(familyKey, kp.publicKey);
    // libsodium sealed box: 32B ephemeral pubkey + 16B nonce + 32B payload + 16B Poly tag
    expect(envelope.length).toBe(80);
  });

  it("rejects a tampered envelope", async () => {
    const familyKey = randomKey();
    const kp = await generateDeviceKeypair();
    const envelope = await wrapKeyForDevice(familyKey, kp.publicKey);
    const tampered = new Uint8Array(envelope);
    tampered[40] ^= 0xff;
    await expect(unwrapKeyForDevice(tampered, kp.publicKey, kp.privateKey)).rejects.toThrow();
  });

  it("rejects wrong keypair", async () => {
    const familyKey = randomKey();
    const kp1 = await generateDeviceKeypair();
    const kp2 = await generateDeviceKeypair();
    const envelope = await wrapKeyForDevice(familyKey, kp1.publicKey);
    await expect(unwrapKeyForDevice(envelope, kp2.publicKey, kp2.privateKey)).rejects.toThrow();
  });

  it("generateDeviceKeypair produces 32-byte keys", async () => {
    const kp = await generateDeviceKeypair();
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });
});
