// Lazy-load libsodium ("sumo" build for XChaCha20 + sealed box + HKDF).
// The .ready Promise resolves once the WASM is parsed.
//
// Import strategy: the resolve alias (vite.config.ts + vitest.config.ts) forces
// the CJS bundle. That bundle exports `module.exports` = a mutable object that
// starts with only a few utility keys and a `ready` Promise; the full crypto API
// (randombytes_buf, crypto_secretstream_*, …) is added onto that same object
// after `ready` resolves.
//
// `import * as sodium` would create a frozen ESM namespace snapshot taken before
// `ready` resolves, so the crypto functions would be missing at call-time.
// `import sodiumModule` (default import) gives a live reference to the mutable
// CJS module.exports object — after `await ready` the functions are on it.

import type * as SodiumType from "libsodium-wrappers-sumo";
// Default import receives module.exports in both Vite dev (pre-bundled CJS→ESM)
// and Vitest (CJS require() interop). In some bundler modes a `.default` wrapper
// is added; the fallback handles both shapes.
import sodiumModule from "libsodium-wrappers-sumo";

export type Sodium = typeof SodiumType;

// Resolve the live module.exports object regardless of bundler interop shape.
const _sodium = ((sodiumModule as unknown as { default?: Sodium }).default ??
  sodiumModule) as unknown as Sodium;

let cached: Sodium | null = null;

export async function sodiumReady(): Promise<Sodium> {
  if (cached) return cached;
  await _sodium.ready;
  cached = _sodium;
  return cached;
}
