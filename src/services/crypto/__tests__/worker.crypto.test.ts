// @vitest-environment node
//
// Crypto worker integration test — encrypt+decrypt round-trip through the RPC
// surface. Runs against the in-process worker shim installed by `worker-shim.ts`
// so that CI exercises the real `worker.ts` request/response wiring (the file
// used to be skipped in Node).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installWorkerShim, uninstallWorkerShim } from "./worker-shim";

beforeEach(async () => {
  await installWorkerShim();
});
afterEach(() => {
  uninstallWorkerShim();
});

describe("cryptoWorker integration — encrypt+decrypt round-trip", () => {
  it("encrypt+decrypt round-trip through the worker", async () => {
    const { cryptoWorker } = await import("../worker-client");

    const familyKey = new Uint8Array(32);
    crypto.getRandomValues(familyKey);

    const plaintext = new TextEncoder().encode("worker round-trip test");

    const meta = {
      verByte: 1,
      familyId: "00000000-0000-7000-8000-000000000001",
      recordId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      recordType: "transaction",
      addedByUserId: "user-001",
      editedByUserId: "user-001",
      updatedAtMap: { amount: "2024-01-01T00:00:00.000Z" },
      deletedAt: "",
    };

    const encrypted = await cryptoWorker.encryptRecord(plaintext, familyKey, meta);
    const recovered = await cryptoWorker.decryptRecord(encrypted.blob, familyKey, meta);
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });
});
