// Vite-bundled Web Worker. Imported by worker-client.ts via the `?worker` suffix.
//
// Key material stays in this worker scope per architecture §7.2 and BR §3.32.
// The main thread receives only public keys and encrypted envelopes — raw private
// key bytes never cross the postMessage boundary outward.

import { sodiumReady } from "./sodium-init";
import { encryptRecord, decryptRecord, type RecordMeta } from "./record-cipher";
import { generateDeviceKeypair, wrapKeyForDevice, unwrapKeyForDevice } from "./envelope";
import {
  wrapRecoveryEnvelope,
  unwrapRecoveryEnvelope,
  wrapPhraseForReveal,
  unwrapPhraseForReveal,
} from "./recovery";

// ── Module-level key state (stays in worker memory) ──────────────────────────

/** Cached device public key for the current sign-in session. */
let cachedDevicePubKey: Uint8Array | null = null;
/** Cached device private key (never leaves the worker). */
let cachedDevicePrivKey: Uint8Array | null = null;

// ── IndexedDB key persistence (worker-only DB; isolated from Dexie main DB) ───
//
// B5d: raw key material lives in a Worker-only IndexedDB named
// `expenses-app-keys`. The main thread's Dexie database (`expenses-app-db`) no
// longer references `cipherKeys`. On first run after deploy we migrate any
// pre-existing rows from the legacy store; subsequent runs read/write only the
// worker-owned DB.

const KEY_DB_NAME = "expenses-app-keys";
const KEY_STORE_NAME = "cipherKeys";
const LEGACY_DB_NAME = "expenses-app-db";
const LEGACY_STORE_NAME = "cipherKeys";

/** Open the worker-owned key DB, creating the object store on first use. */
function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME, { keyPath: "name" });
      }
    };
    req.onsuccess = (ev) => resolve((ev.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Open the legacy Dexie DB without specifying a version. Returns null when
 * the cipherKeys store does not exist (i.e. fresh install) — the caller then
 * skips the legacy migration entirely.
 */
function openLegacyDbIfPresent(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Copy any rows in `expenses-app-db.cipherKeys` into `expenses-app-keys`. Runs
 * at most once per worker session, guarded by `legacyMigrationDone`. Failures
 * are swallowed: if the legacy store is absent or the migration fails, fresh
 * key generation still works against the new DB.
 */
let legacyMigrationDone = false;
async function migrateLegacyKeysOnce(): Promise<void> {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;
  try {
    const legacy = await openLegacyDbIfPresent();
    if (!legacy) return;

    // Read all rows from the legacy store.
    const rows = await new Promise<Array<{ name: string; value: Uint8Array; createdAt?: string }>>(
      (resolve, reject) => {
        const tx = legacy.transaction(LEGACY_STORE_NAME, "readonly");
        const store = tx.objectStore(LEGACY_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () =>
          resolve(req.result as Array<{ name: string; value: Uint8Array; createdAt?: string }>);
        req.onerror = () => reject(req.error);
      },
    );
    legacy.close();

    if (rows.length === 0) return;

    // Write into the worker-owned DB only if the target row is absent.
    const target = await openKeyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = target.transaction(KEY_STORE_NAME, "readwrite");
      const store = tx.objectStore(KEY_STORE_NAME);
      let pending = rows.length;
      let aborted = false;
      for (const row of rows) {
        const getReq = store.get(row.name);
        getReq.onsuccess = () => {
          if (aborted) return;
          if (!getReq.result) {
            const putReq = store.put({
              name: row.name,
              value: row.value,
              createdAt: row.createdAt ?? new Date().toISOString(),
            });
            putReq.onerror = () => {
              aborted = true;
              reject(putReq.error);
            };
          }
          pending--;
          if (pending === 0 && !aborted) resolve();
        };
        getReq.onerror = () => {
          aborted = true;
          reject(getReq.error);
        };
      }
      tx.oncomplete = () => target.close();
    });

    // Clear the legacy rows so reads after the next Dexie upgrade do not race.
    const legacy2 = await openLegacyDbIfPresent();
    if (legacy2) {
      await new Promise<void>((resolve, reject) => {
        const tx = legacy2.transaction(LEGACY_STORE_NAME, "readwrite");
        const store = tx.objectStore(LEGACY_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => legacy2.close();
      });
    }
  } catch {
    // Swallow — legacy migration is best-effort. If it fails, the worker still
    // operates against the new DB; users may need to re-run the recovery flow
    // (or the device.activated path) to repopulate keys.
  }
}

async function putKey(name: string, value: Uint8Array): Promise<void> {
  await migrateLegacyKeysOnce();
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, "readwrite");
    const store = tx.objectStore(KEY_STORE_NAME);
    const req = store.put({ name, value, createdAt: new Date().toISOString() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

async function getKey(name: string): Promise<Uint8Array | null> {
  await migrateLegacyKeysOnce();
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, "readonly");
    const store = tx.objectStore(KEY_STORE_NAME);
    const req = store.get(name);
    req.onsuccess = () => {
      db.close();
      const record = req.result as { name: string; value: Uint8Array } | undefined;
      resolve(record ? record.value : null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Guards the raw-key RPCs (`encryptRecord`, `decryptRecord`, `wrapKeyForDevice`,
 * `unwrapKeyForDevice`) that accept or return key material directly across the
 * postMessage boundary. These exist only for the dev-only CryptoDemoPage
 * sandbox; production code must use the `*WithStoredKey` / `*StoredFamilyKey`
 * variants that keep raw keys inside the worker. Throws outside dev builds so
 * a compromised or careless caller in production can never pull raw key
 * material out of worker scope.
 */
function assertDevOnlyRpc(rpcType: string): void {
  if (!import.meta.env.DEV) {
    throw new Error(`DevOnlyRpc: "${rpcType}" is only available in dev builds`);
  }
}

async function clearAllKeys(): Promise<void> {
  // Run the legacy migration first (same as putKey/getKey). Otherwise, on an
  // upgraded install that has never called putKey/getKey since deploy, this
  // clears only the new `expenses-app-keys` store while legacy rows still
  // sit in `expenses-app-db.cipherKeys` — a later getKey() would then migrate
  // (i.e. resurrect) that key material, defeating the "full reset".
  await migrateLegacyKeysOnce();
  const db = await openKeyDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, "readwrite");
    const store = tx.objectStore(KEY_STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
  cachedDevicePubKey = null;
  cachedDevicePrivKey = null;
}

// ── RPC message types ─────────────────────────────────────────────────────────

type Req =
  | { id: number; type: "init" }
  | { id: number; type: "ping"; payload: string }
  | { id: number; type: "generateDeviceKeypair" }
  | { id: number; type: "generateAndPersistDeviceKey" }
  | { id: number; type: "getDevicePublicKey" }
  | {
      id: number;
      type: "wrapAndPersistFamilyKey";
      devicePubKey: Uint8Array;
      phrase: string;
      familyId: string;
      createdAt: string;
    }
  | {
      id: number;
      type: "encryptRecord";
      plaintext: Uint8Array;
      meta: RecordMeta;
      familyKey: Uint8Array;
    }
  | {
      id: number;
      type: "decryptRecord";
      blob: Uint8Array;
      meta: Omit<RecordMeta, "nonce">;
      familyKey: Uint8Array;
    }
  | { id: number; type: "wrapKeyForDevice"; familyKey: Uint8Array; devicePubKey: Uint8Array }
  | {
      id: number;
      type: "unwrapKeyForDevice";
      envelope: Uint8Array;
      devicePubKey: Uint8Array;
      devicePrivKey: Uint8Array;
    }
  | {
      id: number;
      type: "wrapRecoveryEnvelope";
      familyKey: Uint8Array;
      phrase: string;
      familyId: string;
      createdAt: string;
    }
  | {
      id: number;
      type: "unwrapRecoveryEnvelope";
      envelope: Uint8Array;
      phrase: string;
      familyId: string;
      createdAt: string;
    }
  | {
      id: number;
      type: "wrapPhraseForReveal";
      phrase: string;
      familyKey: Uint8Array;
      familyId: string;
      createdAt: string;
    }
  | {
      id: number;
      type: "unwrapPhraseForReveal";
      envelope: Uint8Array;
      familyKey: Uint8Array;
      familyId: string;
      createdAt: string;
    }
  | {
      id: number;
      type: "encryptRecordWithStoredKey";
      plaintext: Uint8Array;
      meta: RecordMeta;
    }
  | {
      id: number;
      type: "decryptRecordWithStoredKey";
      blob: Uint8Array;
      meta: Omit<RecordMeta, "nonce">;
    }
  | {
      /** Unwraps the 80-byte sealed box from SSE `device.activated`, persists
       *  the resulting familyKey to IndexedDB under "familyKey". */
      id: number;
      type: "unwrapAndPersistFamilyKey";
      envelopeB64u: string;
    }
  | {
      /** Reads the stored familyKey and wraps it for a new device's pubKey,
       *  returning the 80-byte sealed box as base64url. */
      id: number;
      type: "wrapStoredFamilyKeyForDevice";
      devicePubKeyB64u: string;
    }
  | {
      /** Reads the stored familyKey and unwraps Envelope B (phrase ciphertext)
       *  for reveal in Settings → Security. Returns plaintext phrase. */
      id: number;
      type: "unwrapStoredPhraseForReveal";
      phraseCt: Uint8Array;
      familyId: string;
      createdAt: string;
    }
  | {
      /** Reads the stored familyKey and wraps a new Envelope A + Envelope B for
       *  the given phrase. Used by Settings → Security → Regenerate recovery code.
       *  Returns {wrapBytes, phraseCt}. The raw familyKey stays in the worker. */
      id: number;
      type: "regenerateRecoveryEnvelopes";
      phrase: string;
      familyId: string;
      createdAt: string;
    }
  | {
      /** Unwraps Envelope A (recovery wrap) using kRecovery derived from phrase,
       *  then persists the resulting familyKey to IndexedDB. */
      id: number;
      type: "unwrapRecoveryEnvelopeAndPersist";
      recoveryWrap: Uint8Array;
      phrase: string;
      familyId: string;
      createdAt: string;
    }
  | {
      /** Clears all key material from the worker-owned IndexedDB.
       *  Used by `you.removed` and the in-app reset flow. */
      id: number;
      type: "clearAllStoredKeys";
    }
  | {
      /** Computes a short fingerprint of a base64url-encoded device public key
       *  via libsodium's `crypto_generichash` (BLAKE2b, 8-byte digest), then
       *  encodes it as base32 (RFC 4648 alphabet, no padding) → 13 ASCII chars.
       *  Used by `DeviceJoinedBanner` to show a human-verifiable fingerprint
       *  next to Approve / Reject. */
      id: number;
      type: "fingerprintPublicKey";
      pubKeyB64u: string;
    }
  | {
      /** Re-encrypts a batch of solo records under the target family key.
       *  The target key is provided as a sealed envelope wrapped for this
       *  device's public key during accept-invite — the worker unwraps it
       *  inside its own scope using the cached device private key, uses it
       *  to re-encrypt each record, and then (if `persistAfter` is true)
       *  replaces the stored familyKey on success. The raw familyKey never
       *  crosses the postMessage boundary. */
      id: number;
      type: "migrateSoloRecords";
      targetEnvelope: Uint8Array;
      persistAfter: boolean;
      records: Array<{
        recordType: string;
        recordId: string;
        plaintext: Uint8Array;
        meta: RecordMeta;
      }>;
    };

type Res = { id: number; ok: true; result?: unknown } | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case "init": {
        await sodiumReady();
        post({ id: req.id, ok: true });
        return;
      }
      case "ping": {
        post({ id: req.id, ok: true, result: req.payload });
        return;
      }
      case "generateDeviceKeypair": {
        const kp = await generateDeviceKeypair();
        post({ id: req.id, ok: true, result: kp });
        return;
      }
      case "generateAndPersistDeviceKey": {
        // Generate keypair, persist privKey to IndexedDB, cache both in module state,
        // return only the public key to the main thread.
        const kp = await generateDeviceKeypair();
        await putKey("devicePrivKey", kp.privateKey);
        await putKey("devicePubKey", kp.publicKey);
        cachedDevicePubKey = kp.publicKey;
        cachedDevicePrivKey = kp.privateKey;
        post({ id: req.id, ok: true, result: kp.publicKey });
        return;
      }
      case "getDevicePublicKey": {
        // Fall back to the persisted key when the in-memory cache is empty
        // (e.g. after a page reload spawned a fresh worker instance) — the
        // device keypair itself is still persisted in the worker's IndexedDB.
        // Re-populate the cache (both keys) so subsequent calls in this
        // worker session don't need to hit IndexedDB again.
        if (!cachedDevicePubKey) {
          const [storedPub, storedPriv] = await Promise.all([
            getKey("devicePubKey"),
            getKey("devicePrivKey"),
          ]);
          if (storedPub) cachedDevicePubKey = storedPub;
          if (storedPriv) cachedDevicePrivKey = storedPriv;
        }
        post({ id: req.id, ok: true, result: cachedDevicePubKey });
        return;
      }
      case "wrapAndPersistFamilyKey": {
        // Generate familyKey entirely inside the worker.
        // Perform ALL three wrapping operations (device envelope, recovery wrap,
        // phrase ciphertext) so the raw familyKey never crosses the postMessage
        // boundary outward.  Persist familyKey to IndexedDB, then return only
        // the three ciphertext outputs.
        const sodium = await sodiumReady();
        const familyKey = sodium.randombytes_buf(32);
        const deviceEnvelope = await wrapKeyForDevice(familyKey, req.devicePubKey);
        const wrapBytes = await wrapRecoveryEnvelope(
          familyKey,
          req.phrase,
          req.familyId,
          req.createdAt,
        );
        const phraseCt = await wrapPhraseForReveal(
          req.phrase,
          familyKey,
          req.familyId,
          req.createdAt,
        );
        await putKey("familyKey", familyKey);
        post({
          id: req.id,
          ok: true,
          result: { deviceEnvelope, wrapBytes, phraseCt },
        });
        return;
      }
      case "encryptRecord": {
        assertDevOnlyRpc(req.type);
        const result = await encryptRecord(req.plaintext, req.familyKey, req.meta);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "decryptRecord": {
        assertDevOnlyRpc(req.type);
        const result = await decryptRecord({
          blob: req.blob,
          familyKey: req.familyKey,
          meta: req.meta,
        });
        post({ id: req.id, ok: true, result });
        return;
      }
      case "wrapKeyForDevice": {
        assertDevOnlyRpc(req.type);
        const result = await wrapKeyForDevice(req.familyKey, req.devicePubKey);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "unwrapKeyForDevice": {
        assertDevOnlyRpc(req.type);
        const result = await unwrapKeyForDevice(req.envelope, req.devicePubKey, req.devicePrivKey);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "wrapRecoveryEnvelope": {
        const result = await wrapRecoveryEnvelope(
          req.familyKey,
          req.phrase,
          req.familyId,
          req.createdAt,
        );
        post({ id: req.id, ok: true, result });
        return;
      }
      case "unwrapRecoveryEnvelope": {
        const result = await unwrapRecoveryEnvelope(
          req.envelope,
          req.phrase,
          req.familyId,
          req.createdAt,
        );
        post({ id: req.id, ok: true, result });
        return;
      }
      case "wrapPhraseForReveal": {
        const result = await wrapPhraseForReveal(
          req.phrase,
          req.familyKey,
          req.familyId,
          req.createdAt,
        );
        post({ id: req.id, ok: true, result });
        return;
      }
      case "unwrapPhraseForReveal": {
        const result = await unwrapPhraseForReveal(
          req.envelope,
          req.familyKey,
          req.familyId,
          req.createdAt,
        );
        post({ id: req.id, ok: true, result });
        return;
      }
      case "encryptRecordWithStoredKey": {
        // Retrieve familyKey from IndexedDB — stays in worker scope.
        const storedKey = await getKey("familyKey");
        if (!storedKey) {
          post({
            id: req.id,
            ok: false,
            error: "NoStoredFamilyKey: no familyKey found in worker storage",
          });
          return;
        }
        const result = await encryptRecord(req.plaintext, storedKey, req.meta);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "decryptRecordWithStoredKey": {
        const storedKey = await getKey("familyKey");
        if (!storedKey) {
          post({
            id: req.id,
            ok: false,
            error: "NoStoredFamilyKey: no familyKey found in worker storage",
          });
          return;
        }
        const result = await decryptRecord({
          blob: req.blob,
          familyKey: storedKey,
          meta: req.meta,
        });
        post({ id: req.id, ok: true, result });
        return;
      }
      case "unwrapAndPersistFamilyKey": {
        // Decode base64url envelope.
        const padded = req.envelopeB64u.replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (padded.length % 4)) % 4;
        const b64 = padded + "=".repeat(padLen);
        const binary = atob(b64);
        const envelopeBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) envelopeBytes[i] = binary.charCodeAt(i);

        // Load device keys from IndexedDB (private key stays in worker).
        const storedPub = cachedDevicePubKey ?? (await getKey("devicePubKey"));
        const storedPriv = cachedDevicePrivKey ?? (await getKey("devicePrivKey"));
        if (!storedPub || !storedPriv) {
          post({
            id: req.id,
            ok: false,
            error: "NoDeviceKey: device keypair not found in worker storage",
          });
          return;
        }

        const familyKey = await unwrapKeyForDevice(envelopeBytes, storedPub, storedPriv);
        await putKey("familyKey", familyKey);
        post({ id: req.id, ok: true });
        return;
      }
      case "wrapStoredFamilyKeyForDevice": {
        const storedFamilyKey = await getKey("familyKey");
        if (!storedFamilyKey) {
          post({
            id: req.id,
            ok: false,
            error: "NoStoredFamilyKey: no familyKey found in worker storage",
          });
          return;
        }

        // Decode target device public key.
        const padded2 = req.devicePubKeyB64u.replace(/-/g, "+").replace(/_/g, "/");
        const padLen2 = (4 - (padded2.length % 4)) % 4;
        const b642 = padded2 + "=".repeat(padLen2);
        const binary2 = atob(b642);
        const targetPubKey = new Uint8Array(binary2.length);
        for (let i = 0; i < binary2.length; i++) targetPubKey[i] = binary2.charCodeAt(i);

        const envelope = await wrapKeyForDevice(storedFamilyKey, targetPubKey);

        // Encode result as base64url (no padding).
        const envB64 = btoa(String.fromCharCode(...envelope));
        const envB64u = envB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        post({ id: req.id, ok: true, result: envB64u });
        return;
      }
      case "unwrapStoredPhraseForReveal": {
        const storedFamilyKey2 = await getKey("familyKey");
        if (!storedFamilyKey2) {
          post({
            id: req.id,
            ok: false,
            error: "NoStoredFamilyKey: no familyKey found in worker storage",
          });
          return;
        }
        const phrase2 = await unwrapPhraseForReveal(
          req.phraseCt,
          storedFamilyKey2,
          req.familyId,
          req.createdAt,
        );
        post({ id: req.id, ok: true, result: phrase2 });
        return;
      }
      case "regenerateRecoveryEnvelopes": {
        const storedFamilyKey3 = await getKey("familyKey");
        if (!storedFamilyKey3) {
          post({
            id: req.id,
            ok: false,
            error: "NoStoredFamilyKey: no familyKey found in worker storage",
          });
          return;
        }
        const [wrapBytes3, phraseCt3] = await Promise.all([
          wrapRecoveryEnvelope(storedFamilyKey3, req.phrase, req.familyId, req.createdAt),
          wrapPhraseForReveal(req.phrase, storedFamilyKey3, req.familyId, req.createdAt),
        ]);
        post({ id: req.id, ok: true, result: { wrapBytes: wrapBytes3, phraseCt: phraseCt3 } });
        return;
      }
      case "unwrapRecoveryEnvelopeAndPersist": {
        // unwrapRecoveryEnvelope internally calls deriveRecoveryKey — no double derivation needed.
        const familyKey2 = await unwrapRecoveryEnvelope(
          req.recoveryWrap,
          req.phrase,
          req.familyId,
          req.createdAt,
        );
        await putKey("familyKey", familyKey2);
        post({ id: req.id, ok: true });
        return;
      }
      case "clearAllStoredKeys": {
        await clearAllKeys();
        post({ id: req.id, ok: true });
        return;
      }
      case "fingerprintPublicKey": {
        const sodium = await sodiumReady();
        // Decode base64url.
        const paddedFp = req.pubKeyB64u.replace(/-/g, "+").replace(/_/g, "/");
        const padLenFp = (4 - (paddedFp.length % 4)) % 4;
        const b64Fp = paddedFp + "=".repeat(padLenFp);
        const binaryFp = atob(b64Fp);
        const pubKeyBytes = new Uint8Array(binaryFp.length);
        for (let i = 0; i < binaryFp.length; i++) pubKeyBytes[i] = binaryFp.charCodeAt(i);
        const digest = sodium.crypto_generichash(8, pubKeyBytes);
        // Base32 (RFC 4648), no padding. 8 bytes → 13 chars.
        const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = 0;
        let value = 0;
        let out = "";
        for (let i = 0; i < digest.length; i++) {
          value = (value << 8) | digest[i];
          bits += 8;
          while (bits >= 5) {
            bits -= 5;
            out += ALPHABET[(value >>> bits) & 0x1f];
          }
        }
        if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
        post({ id: req.id, ok: true, result: out });
        return;
      }
      case "migrateSoloRecords": {
        // Unwrap the target family key inside the worker using the cached
        // device keypair. The unwrapped key never leaves this scope.
        const storedPubMig = cachedDevicePubKey ?? (await getKey("devicePubKey"));
        const storedPrivMig = cachedDevicePrivKey ?? (await getKey("devicePrivKey"));
        if (!storedPubMig || !storedPrivMig) {
          post({
            id: req.id,
            ok: false,
            error: "NoDeviceKey: device keypair not found in worker storage",
          });
          return;
        }
        const targetFamilyKey = await unwrapKeyForDevice(
          req.targetEnvelope,
          storedPubMig,
          storedPrivMig,
        );

        const encrypted: Array<{
          recordType: string;
          recordId: string;
          blob: Uint8Array;
          plaintextByteCount: number;
        }> = [];
        for (const rec of req.records) {
          const { blob, plaintextByteCount } = await encryptRecord(
            rec.plaintext,
            targetFamilyKey,
            rec.meta,
          );
          encrypted.push({
            recordType: rec.recordType,
            recordId: rec.recordId,
            blob,
            plaintextByteCount,
          });
        }

        if (req.persistAfter) {
          await putKey("familyKey", targetFamilyKey);
        }
        // Best-effort zero of the local reference. JS can't enforce wipe, but
        // we drop the binding so the value becomes garbage-collectable.
        targetFamilyKey.fill(0);

        post({ id: req.id, ok: true, result: encrypted });
        return;
      }
      default: {
        const _exhaustive: never = req;
        void _exhaustive;
        post({ id: (req as { id: number }).id, ok: false, error: "unknown request type" });
      }
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

function post(msg: Res) {
  (self as unknown as Worker).postMessage(msg);
}
