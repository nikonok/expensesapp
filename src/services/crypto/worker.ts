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

// ── IndexedDB key persistence (inline, no Dexie dependency in worker) ─────────

const DB_NAME = "expenses-app-db";
const STORE_NAME = "cipherKeys";

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Open without specifying a version so we match whatever version Dexie has
    // already migrated to.  The cipherKeys store is created by Dexie's v3 migration
    // (database.ts) before this code runs, so no onupgradeneeded logic is needed.
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = (ev) => resolve((ev.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function putKey(name: string, value: Uint8Array): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ name, value, createdAt: new Date().toISOString() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

async function getKey(name: string): Promise<Uint8Array | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
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
    }
  | {
      id: number;
      type: "unwrapPhraseForReveal";
      envelope: Uint8Array;
      familyKey: Uint8Array;
      familyId: string;
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
        const phraseCt = await wrapPhraseForReveal(req.phrase, familyKey, req.familyId);
        await putKey("familyKey", familyKey);
        post({
          id: req.id,
          ok: true,
          result: { deviceEnvelope, wrapBytes, phraseCt },
        });
        return;
      }
      case "encryptRecord": {
        const result = await encryptRecord(req.plaintext, req.familyKey, req.meta);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "decryptRecord": {
        const result = await decryptRecord({
          blob: req.blob,
          familyKey: req.familyKey,
          meta: req.meta,
        });
        post({ id: req.id, ok: true, result });
        return;
      }
      case "wrapKeyForDevice": {
        const result = await wrapKeyForDevice(req.familyKey, req.devicePubKey);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "unwrapKeyForDevice": {
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
        const result = await wrapPhraseForReveal(req.phrase, req.familyKey, req.familyId);
        post({ id: req.id, ok: true, result });
        return;
      }
      case "unwrapPhraseForReveal": {
        const result = await unwrapPhraseForReveal(req.envelope, req.familyKey, req.familyId);
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
