// Lazy-load libsodium ("sumo" build for XChaCha20 + sealed box + HKDF).
// The .ready Promise resolves once the WASM is parsed.
// libsodium-wrappers-sumo uses named exports; `ready` is a named Promise<void>.

import * as sodium from "libsodium-wrappers-sumo";

export type Sodium = typeof sodium;

let cached: Sodium | null = null;

export async function sodiumReady(): Promise<Sodium> {
  if (cached) return cached;
  await sodium.ready;
  cached = sodium;
  return cached;
}
