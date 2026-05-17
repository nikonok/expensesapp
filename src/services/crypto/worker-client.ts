// Lazy-creates the singleton Worker on first use. All crypto operations route
// through here so key material stays inside the worker scope.

import CryptoWorker from "./worker?worker";

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
  // 2.c will extend: encryptRecord, decryptRecord, wrapKeyForDevice, unwrapKeyForDevice,
  //                  deriveRecoveryKey, wrapRecovery, unwrapRecovery
};
