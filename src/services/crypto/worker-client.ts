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

  wrapPhraseForReveal: (
    phrase: string,
    familyKey: Uint8Array,
    familyId: string,
    createdAt: string,
  ) => call<Uint8Array>({ type: "wrapPhraseForReveal", phrase, familyKey, familyId, createdAt }),

  unwrapPhraseForReveal: (
    envelope: Uint8Array,
    familyKey: Uint8Array,
    familyId: string,
    createdAt: string,
  ) => call<string>({ type: "unwrapPhraseForReveal", envelope, familyKey, familyId, createdAt }),

  /**
   * Encrypt a record using the familyKey stored in the worker's IndexedDB.
   * Throws a typed error (message starts with "NoStoredFamilyKey:") if no
   * familyKey has been persisted yet (e.g., family not yet initialised).
   */
  encryptRecordWithStoredKey: (plaintext: Uint8Array, meta: RecordMeta) =>
    call<EncryptedRecord>({ type: "encryptRecordWithStoredKey", plaintext, meta }),

  /**
   * Decrypt a record using the familyKey stored in the worker's IndexedDB.
   * Throws a typed error (message starts with "NoStoredFamilyKey:") if no
   * familyKey has been persisted yet.
   */
  decryptRecordWithStoredKey: (blob: Uint8Array, meta: Omit<RecordMeta, "nonce">) =>
    call<Uint8Array>({ type: "decryptRecordWithStoredKey", blob, meta }),

  /**
   * Unwraps the 80-byte sealed-box envelope from a `device.activated` SSE event
   * using the stored device keypair, then persists the resulting familyKey to
   * worker IndexedDB. The raw familyKey never crosses the postMessage boundary.
   * Throws "NoDeviceKey:" if no device keypair is stored.
   */
  unwrapAndPersistFamilyKey: (envelopeB64u: string) =>
    call<void>({ type: "unwrapAndPersistFamilyKey", envelopeB64u }),

  /**
   * Reads the stored familyKey from worker IndexedDB and wraps it for a new
   * device's public key (base64url). Returns the 80-byte sealed-box envelope
   * as base64url. The raw familyKey never crosses the postMessage boundary.
   * Throws "NoStoredFamilyKey:" if no familyKey is stored.
   */
  wrapStoredFamilyKeyForDevice: (devicePubKeyB64u: string) =>
    call<string>({ type: "wrapStoredFamilyKeyForDevice", devicePubKeyB64u }),

  /**
   * Reads the stored familyKey and wraps a new Envelope A + Envelope B for the
   * provided phrase (recovery code regeneration). The raw familyKey stays in
   * the worker. Returns {wrapBytes, phraseCt}.
   * Throws "NoStoredFamilyKey:" if no familyKey is stored.
   */
  regenerateRecoveryEnvelopes: (phrase: string, familyId: string, createdAt: string) =>
    call<{ wrapBytes: Uint8Array; phraseCt: Uint8Array }>({
      type: "regenerateRecoveryEnvelopes",
      phrase,
      familyId,
      createdAt,
    }),

  /**
   * Reads the stored familyKey and decrypts the Envelope B (phrase ciphertext)
   * produced by wrapPhraseForReveal. Returns the plaintext 24-word phrase.
   * Used by Settings → Security → "Show recovery code".
   * `createdAt` must match the family creation timestamp used at wrap time
   * (only enforced for envelope version 2+; v1 envelopes ignore it). The
   * server returns the value alongside the phraseCt in the reveal response.
   * Throws "NoStoredFamilyKey:" if no familyKey is stored.
   */
  unwrapStoredPhraseForReveal: (phraseCt: Uint8Array, familyId: string, createdAt: string) =>
    call<string>({ type: "unwrapStoredPhraseForReveal", phraseCt, familyId, createdAt }),

  /**
   * Derives a 32-byte kRecovery from the BIP39 phrase and familyId via Argon2id.
   * The key is returned to the caller (it does NOT persist to IndexedDB here).
   */
  deriveRecoveryKey: (phrase: string, familyId: string) =>
    call<Uint8Array>({ type: "deriveRecoveryKey", phrase, familyId }),

  /**
   * Unwraps Envelope A (cold recovery) using kRecovery derived from phrase + familyId,
   * then persists the resulting familyKey to worker IndexedDB.
   * The raw familyKey never crosses the postMessage boundary.
   */
  unwrapRecoveryEnvelopeAndPersist: (
    recoveryWrap: Uint8Array,
    phrase: string,
    familyId: string,
    createdAt: string,
  ) =>
    call<void>({
      type: "unwrapRecoveryEnvelopeAndPersist",
      recoveryWrap,
      phrase,
      familyId,
      createdAt,
    }),

  /**
   * Clears all key material in the worker-owned IndexedDB (`expenses-app-keys`).
   * Used by the `you.removed` SSE branch and the in-app reset flow — neither
   * of which should touch the main-thread Dexie key store directly (B5d).
   */
  clearAllStoredKeys: () => call<void>({ type: "clearAllStoredKeys" }),

  /**
   * Returns a short, human-verifiable fingerprint (13 base32 chars) of a
   * device public key. Computed via libsodium `crypto_generichash(8, pubKey)`.
   * Shown next to Approve / Reject in the DeviceJoinedBanner.
   */
  fingerprintPublicKey: (pubKeyB64u: string) =>
    call<string>({ type: "fingerprintPublicKey", pubKeyB64u }),

  /**
   * Re-encrypts solo records under the target family key without exposing the
   * raw key to the main thread. Pass the sealed envelope obtained during
   * acceptInvite + a batch of records (plaintext bytes + meta). The worker
   * unwraps the envelope using its cached device keypair, encrypts each
   * record, optionally persists the new key, and returns the encrypted batch.
   */
  migrateSoloRecords: (
    targetEnvelope: Uint8Array,
    persistAfter: boolean,
    records: Array<{
      recordType: string;
      recordId: string;
      plaintext: Uint8Array;
      meta: RecordMeta;
    }>,
  ) =>
    call<
      Array<{
        recordType: string;
        recordId: string;
        blob: Uint8Array;
        plaintextByteCount: number;
      }>
    >({ type: "migrateSoloRecords", targetEnvelope, persistAfter, records }),
};
