// Vite-bundled Web Worker. Imported by worker-client.ts via the `?worker` suffix.
//
// Phase 3 will move familyKey / devicePrivKey persistence into this worker scope.
// For now keys are passed per-call — the architecture constraint (§7.2, BR §3.32)
// is that long-lived key storage must NOT cross the postMessage boundary outward.

import { sodiumReady } from "./sodium-init";
import { encryptRecord, decryptRecord, type RecordMeta } from "./record-cipher";
import { generateDeviceKeypair, wrapKeyForDevice, unwrapKeyForDevice } from "./envelope";
import {
  wrapRecoveryEnvelope,
  unwrapRecoveryEnvelope,
  wrapPhraseForReveal,
  unwrapPhraseForReveal,
} from "./recovery";

type Req =
  | { id: number; type: "init" }
  | { id: number; type: "ping"; payload: string }
  | { id: number; type: "generateDeviceKeypair" }
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
