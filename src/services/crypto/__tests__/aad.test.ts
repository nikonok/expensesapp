// @vitest-environment node

import { describe, it, expect } from "vitest";
import vectors from "../../../../backend/internal/crypto/testdata/aad-vectors.json";
import { serializeAAD } from "../aad";

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("serializeAAD — cross-language golden vectors", () => {
  for (const v of vectors.vectors) {
    it(v.name, async () => {
      const input = {
        verByte: v.input.verByte,
        familyId: v.input.familyId,
        recordId: v.input.recordId,
        recordType: v.input.recordType,
        addedByUserId: v.input.addedByUserId,
        editedByUserId: v.input.editedByUserId,
        updatedAtMap: v.input.updatedAtMap as Record<string, string>,
        deletedAt: v.input.deletedAt,
        plaintextByteCount: v.input.plaintextByteCount,
        nonce: hexDecode(v.input.nonceHex),
      };
      const aad = await serializeAAD(input);
      expect(hexEncode(aad)).toBe(v.expectedAADHex);
    });
  }
});

describe("serializeAAD — input validation", () => {
  it("rejects nonce of length 23", async () => {
    await expect(
      serializeAAD({
        verByte: 1,
        familyId: "a",
        recordId: "b",
        recordType: "transaction",
        addedByUserId: "c",
        editedByUserId: "c",
        updatedAtMap: {},
        deletedAt: "",
        plaintextByteCount: 0,
        nonce: new Uint8Array(23),
      }),
    ).rejects.toThrow();
  });
});
