import { sodiumReady } from "./sodium-init";

export async function wrapKeyForDevice(
  familyKey: Uint8Array,
  devicePubKey: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  // crypto_box_seal: 80-byte output for a 32-byte payload.
  // Overhead = crypto_box_SEALBYTES = 48 bytes: 32B ephemeral pubkey + 16B Poly1305 tag.
  // Nonce is derived (HSalsa20 over ephemeral_pk || recipient_pk) and is NOT stored.
  return sodium.crypto_box_seal(familyKey, devicePubKey);
}

export async function unwrapKeyForDevice(
  envelope: Uint8Array,
  devicePubKey: Uint8Array,
  devicePrivKey: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  return sodium.crypto_box_seal_open(envelope, devicePubKey, devicePrivKey);
}

export interface DeviceKeypair {
  publicKey: Uint8Array; // 32 bytes (X25519)
  privateKey: Uint8Array; // 32 bytes (X25519)
}

export async function generateDeviceKeypair(): Promise<DeviceKeypair> {
  const sodium = await sodiumReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}
