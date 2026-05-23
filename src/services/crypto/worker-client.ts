// Lazy-creates the singleton Worker on first use. All crypto operations route
// through here so key material stays inside the worker scope.

import CryptoWorker from "./worker?worker";
import type { RecordMeta, EncryptedRecord } from "./record-cipher";
import type { DeviceKeypair } from "./envelope";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new CryptoWorker();
  worker.onmessage = (
    e: MessageEvent<{
      id: number;
      ok: boolean;
      result?: unknown;
      error?: string;
    }>,
  ) => {
    const { id, ok, result, error } = e.data;
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    if (ok) slot.resolve(result);
    else slot.reject(new Error(error ?? "worker error"));
  };
  worker.onerror = (e: ErrorEvent) => {
    const msg = e.message ?? "worker crashed";
    for (const slot of pending.values()) slot.reject(new Error(msg));
    pending.clear();
    worker = null; // allow re-spawn on next call
  };
  return worker;
}

function call<T>(req: { type: string; [k: string]: unknown }): Promise<T> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, ...req });
  });
}

export const cryptoWorker = {
  init: () => call<void>({ type: "init" }),
  ping: (payload: string) => call<string>({ type: "ping", payload }),

  generateDeviceKeypair: () => call<DeviceKeypair>({ type: "generateDeviceKeypair" }),

  /** Generates a device keypair, persists the private key inside the worker's
   * IndexedDB, caches both keys in worker module state, and returns ONLY the
   * public key.  The private key never crosses the postMessage boundary. */
  generateAndPersistDeviceKey: () => call<Uint8Array>({ type: "generateAndPersistDeviceKey" }),

  /** Returns the cached device public key from the worker's module state
   * (populated by generateAndPersistDeviceKey). */
  getDevicePublicKey: () => call<Uint8Array | null>({ type: "getDevicePublicKey" }),

  /** Generates a 32-byte familyKey inside the worker, performs all three
   * wrapping operations (device envelope, recovery wrap, phrase ciphertext),
   * persists the familyKey to IndexedDB, and returns only the ciphertexts.
   * The raw familyKey never crosses the postMessage boundary outward. */
  wrapAndPersistFamilyKey: (
    devicePubKey: Uint8Array,
    phrase: string,
    familyId: string,
    createdAt: string,
  ) =>
    call<{ deviceEnvelope: Uint8Array; wrapBytes: Uint8Array; phraseCt: Uint8Array }>({
      type: "wrapAndPersistFamilyKey",
      devicePubKey,
      phrase,
      familyId,
      createdAt,
    }),

  encryptRecord: (plaintext: Uint8Array, familyKey: Uint8Array, meta: RecordMeta) =>
    call<EncryptedRecord>({ type: "encryptRecord", plaintext, familyKey, meta }),

  decryptRecord: (blob: Uint8Array, familyKey: Uint8Array, meta: Omit<RecordMeta, "nonce">) =>
    call<Uint8Array>({ type: "decryptRecord", blob, familyKey, meta }),

  wrapKeyForDevice: (familyKey: Uint8Array, devicePubKey: Uint8Array) =>
    call<Uint8Array>({ type: "wrapKeyForDevice", familyKey, devicePubKey }),

  unwrapKeyForDevice: (envelope: Uint8Array, devicePubKey: Uint8Array, devicePrivKey: Uint8Array) =>
    call<Uint8Array>({ type: "unwrapKeyForDevice", envelope, devicePubKey, devicePrivKey }),

  wrapRecoveryEnvelope: (
    familyKey: Uint8Array,
    phrase: string,
    familyId: string,
    createdAt: string,
  ) => call<Uint8Array>({ type: "wrapRecoveryEnvelope", familyKey, phrase, familyId, createdAt }),

  unwrapRecoveryEnvelope: (
    envelope: Uint8Array,
    phrase: string,
    familyId: string,
    createdAt: string,
  ) => call<Uint8Array>({ type: "unwrapRecoveryEnvelope", envelope, phrase, familyId, createdAt }),

  wrapPhraseForReveal: (phrase: string, familyKey: Uint8Array, familyId: string) =>
    call<Uint8Array>({ type: "wrapPhraseForReveal", phrase, familyKey, familyId }),

  unwrapPhraseForReveal: (envelope: Uint8Array, familyKey: Uint8Array, familyId: string) =>
    call<string>({ type: "unwrapPhraseForReveal", envelope, familyKey, familyId }),
};
