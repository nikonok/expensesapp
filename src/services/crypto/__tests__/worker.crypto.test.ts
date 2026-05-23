import { describe, it, expect } from "vitest";

// Web Workers are not available in Vitest's Node environment.
// The real worker round-trip is exercised in the Phase 2 dev playground (2.demo).
const hasWorker = typeof Worker !== "undefined";

describe.skipIf(!hasWorker)("cryptoWorker integration — encrypt+decrypt round-trip", () => {
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
