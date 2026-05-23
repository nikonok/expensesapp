import { sodiumReady } from "./sodium-init";

const PREFIX = new TextEncoder().encode("commit-v1");

export async function commitTag(familyKey: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  const input = new Uint8Array(PREFIX.length + nonce.length);
  input.set(PREFIX, 0);
  input.set(nonce, PREFIX.length);
  // crypto_auth_hmacsha256(message, key) → 32-byte tag
  return sodium.crypto_auth_hmacsha256(input, familyKey);
}
