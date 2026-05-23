// Canonical AAD serializer per docs/backend/architecture.md §7.4.
// MUST produce byte-identical output to backend/internal/crypto/aad.go.
// Cross-language byte identity is verified by golden vectors in
// backend/internal/crypto/testdata/aad-vectors.json.

export interface AADInput {
  verByte: number;
  familyId: string;
  recordId: string;
  recordType: string;
  addedByUserId: string;
  editedByUserId: string;
  updatedAtMap: Record<string, string>;
  deletedAt: string; // RFC3339 ms, or "" for none
  plaintextByteCount: number;
  nonce: Uint8Array; // exactly 24 bytes
}

const enc = new TextEncoder();

function uint32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

function lp(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  out.set(uint32BE(bytes.length), 0);
  out.set(bytes, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function updatedAtMapDigest(m: Record<string, string>): Promise<Uint8Array> {
  const keys = Object.keys(m).sort();
  const parts: Uint8Array[] = [];
  for (const k of keys) {
    parts.push(enc.encode(k + "=" + m[k] + "\n"));
  }
  const content = concat(parts);
  const digest = await crypto.subtle.digest("SHA-256", content.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

export async function serializeAAD(input: AADInput): Promise<Uint8Array> {
  if (input.nonce.length !== 24) {
    throw new Error("nonce must be 24 bytes");
  }

  const prefix = enc.encode("expapp-rec-v1");
  const verByte = new Uint8Array([input.verByte]);
  const familyIdLp = lp(enc.encode(input.familyId));
  const recordIdLp = lp(enc.encode(input.recordId));
  const recordTypeLp = lp(enc.encode(input.recordType));
  const addedByLp = lp(enc.encode(input.addedByUserId));
  const editedByLp = lp(enc.encode(input.editedByUserId));

  const digest = await updatedAtMapDigest(input.updatedAtMap);
  const digestLp = lp(digest);

  const deletedAtLp =
    input.deletedAt === "" ? lp(new Uint8Array(0)) : lp(enc.encode(input.deletedAt));

  const plaintextCount = uint32BE(input.plaintextByteCount);
  const nonceLp = lp(input.nonce);

  return concat([
    prefix,
    verByte,
    familyIdLp,
    recordIdLp,
    recordTypeLp,
    addedByLp,
    editedByLp,
    digestLp,
    deletedAtLp,
    plaintextCount,
    nonceLp,
  ]);
}
