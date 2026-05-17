// Vite-bundled Web Worker. Imported by worker-client.ts via the `?worker` suffix.

import { sodiumReady } from "./sodium-init";

type Req = { id: number; type: "init" } | { id: number; type: "ping"; payload: string };

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
