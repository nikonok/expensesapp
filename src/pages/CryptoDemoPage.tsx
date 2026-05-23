// DEV-ONLY: in-app crypto demo playground per architecture.md §12 Phase 2 DoD.
// Gated by import.meta.env.DEV at the route level in App.tsx — never ships in prod.

import { useState } from "react";
import { cryptoWorker } from "@/services/crypto/worker-client";
import { sodiumReady } from "@/services/crypto/sodium-init";
import { deriveRecoveryKey } from "@/services/crypto/argon-init";
import { serializeAAD } from "@/services/crypto/aad";
import vectors from "../../backend/internal/crypto/testdata/aad-vectors.json";

// ── helpers ──────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function truncHex(hex: string): string {
  if (hex.length <= 32) return hex;
  return hex.slice(0, 32) + " ...";
}

// ── timing color ─────────────────────────────────────────────────────────────

function argonTimingColor(ms: number): string {
  if (ms >= 400 && ms <= 800) return "var(--color-income)";
  if ((ms >= 200 && ms < 400) || (ms > 800 && ms <= 1500)) return "oklch(80% 0.22 85)";
  return "var(--color-expense)";
}

// ── result types ─────────────────────────────────────────────────────────────

interface Demo1Result {
  ok: boolean;
  ms: number;
  blobHex: string;
  blobLen: number;
}

interface Demo2Result {
  ok: boolean;
  ms: number;
  envelopeHex: string;
  envelopeLen: number;
}

interface Demo3Result {
  ok: boolean;
  ms: number;
  keyHex: string;
}

interface Demo4VectorResult {
  name: string;
  ok: boolean;
  got?: string;
  expected?: string;
}

type DemoState<T> =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: T }
  | { status: "error"; message: string };

// ── shared style atoms ────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "var(--space-5)",
  marginBottom: "var(--space-5)",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "DM Sans, sans-serif",
  fontSize: "var(--text-caption)",
  color: "var(--color-text-secondary)",
  marginBottom: "var(--space-2)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  color: "var(--color-text-secondary)",
  wordBreak: "break-all",
};

const chipBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 10px",
  borderRadius: 999,
  fontFamily: "DM Sans, sans-serif",
  fontSize: "var(--text-caption)",
  fontWeight: 600,
};

function PassChip({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        ...chipBase,
        background: ok ? "var(--color-income-dim)" : "var(--color-expense-dim)",
        color: ok ? "var(--color-income)" : "var(--color-expense)",
      }}
    >
      {ok ? "✓ PASS" : "✗ FAIL"}
    </span>
  );
}

function RunButton({
  label,
  onClick,
  running,
}: {
  label: string;
  onClick: () => void;
  running: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 20px",
        borderRadius: 8,
        border: "none",
        background: running ? "var(--color-border)" : "var(--color-primary)",
        color: running ? "var(--color-text-secondary)" : "var(--color-bg)",
        fontFamily: "Syne, sans-serif",
        fontWeight: 700,
        fontSize: "var(--text-body)",
        cursor: running ? "not-allowed" : "pointer",
        minHeight: 44,
        transition: "opacity 0.15s",
      }}
    >
      {running ? "Running…" : label}
    </button>
  );
}

function TimingBadge({ ms, colored }: { ms: number; colored?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
        color: colored ? argonTimingColor(ms) : "var(--color-text-secondary)",
        marginLeft: "var(--space-3)",
      }}
    >
      {ms.toFixed(1)} ms
    </span>
  );
}

// ── Demo 1: record encrypt → decrypt round-trip ───────────────────────────────

async function runEncryptDecrypt(): Promise<Demo1Result> {
  const sodium = await sodiumReady();
  const familyKey = sodium.randombytes_buf(32);
  const familyId = "00000000-0000-7000-8000-00000000aaaa";
  const recordId = "00000000-0000-7000-8000-00000000bbbb";
  const userId = "00000000-0000-7000-8000-00000000cccc";

  const plaintext = new TextEncoder().encode(
    JSON.stringify({ amount: 12345, note: "demo transaction", currency: "USD" }),
  );

  const meta = {
    verByte: 1,
    familyId,
    recordId,
    recordType: "transaction",
    addedByUserId: userId,
    editedByUserId: userId,
    updatedAtMap: {
      amount: "2026-05-17T10:00:00.000Z",
      note: "2026-05-17T10:00:00.000Z",
    },
    deletedAt: "",
  };

  const t0 = performance.now();
  const { blob } = await cryptoWorker.encryptRecord(plaintext, familyKey, meta);
  const decoded = await cryptoWorker.decryptRecord(blob, familyKey, meta);
  const t1 = performance.now();

  const ok = decoded.length === plaintext.length && decoded.every((b, i) => b === plaintext[i]);

  return { ok, ms: t1 - t0, blobHex: toHex(blob), blobLen: blob.length };
}

// ── Demo 2: device key wrap → unwrap ─────────────────────────────────────────

async function runEnvelope(): Promise<Demo2Result> {
  const sodium = await sodiumReady();
  const familyKey = sodium.randombytes_buf(32);
  const kp = await cryptoWorker.generateDeviceKeypair();

  const t0 = performance.now();
  const envelope = await cryptoWorker.wrapKeyForDevice(familyKey, kp.publicKey);
  const recovered = await cryptoWorker.unwrapKeyForDevice(envelope, kp.publicKey, kp.privateKey);
  const t1 = performance.now();

  const ok = recovered.length === familyKey.length && recovered.every((b, i) => b === familyKey[i]);

  return { ok, ms: t1 - t0, envelopeHex: toHex(envelope), envelopeLen: envelope.length };
}

// ── Demo 3: Argon2id timing ───────────────────────────────────────────────────
// Note: deriveRecoveryKey runs on the main thread for now. It's a one-shot
// recovery path so main-thread blocking is acceptable. Phase 3+ may move it
// to the worker.

const FIXED_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const FIXED_FAMILY = "00000000-0000-7000-8000-000000000001";

async function runArgon(): Promise<Demo3Result> {
  const t0 = performance.now();
  const key = await deriveRecoveryKey(FIXED_PHRASE, FIXED_FAMILY);
  const t1 = performance.now();
  return { ok: key.length === 32, ms: t1 - t0, keyHex: toHex(key) };
}

// ── Demo 4: AAD golden vectors ────────────────────────────────────────────────

async function runAADVectors(): Promise<Demo4VectorResult[]> {
  const results: Demo4VectorResult[] = [];
  for (const v of vectors.vectors) {
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
    const got = toHex(await serializeAAD(input));
    results.push({
      name: v.name,
      ok: got === v.expectedAADHex,
      got,
      expected: v.expectedAADHex,
    });
  }
  return results;
}

// ── Demo card wrappers ─────────────────────────────────────────────────────────

function Demo1Card() {
  const [state, setState] = useState<DemoState<Demo1Result>>({ status: "idle" });

  async function handleRun() {
    setState({ status: "running" });
    try {
      const result = await runEncryptDecrypt();
      setState({ status: "done", result });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <h2
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-subheading)",
            color: "var(--color-text)",
            margin: 0,
            marginBottom: "var(--space-2)",
          }}
        >
          Demo 1: Record encrypt → decrypt round-trip
        </h2>
        <p
          style={{
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          Encrypts a JSON transaction payload with a random family key, then decrypts and verifies
          byte equality. Routed through the crypto worker.
        </p>
      </div>

      <RunButton label="Run Demo 1" onClick={handleRun} running={state.status === "running"} />

      {state.status === "done" && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              marginBottom: "var(--space-3)",
            }}
          >
            <PassChip ok={state.result.ok} />
            <TimingBadge ms={state.result.ms} />
          </div>
          <div style={{ marginBottom: "var(--space-2)" }}>
            <div style={labelStyle}>Blob ({state.result.blobLen} bytes)</div>
            <div style={monoStyle}>{truncHex(state.result.blobHex)}</div>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div
          style={{
            marginTop: "var(--space-3)",
            color: "var(--color-expense)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
          }}
        >
          Error: {state.message}
        </div>
      )}
    </div>
  );
}

function Demo2Card() {
  const [state, setState] = useState<DemoState<Demo2Result>>({ status: "idle" });

  async function handleRun() {
    setState({ status: "running" });
    try {
      const result = await runEnvelope();
      setState({ status: "done", result });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <h2
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-subheading)",
            color: "var(--color-text)",
            margin: 0,
            marginBottom: "var(--space-2)",
          }}
        >
          Demo 2: Device key wrap → unwrap round-trip
        </h2>
        <p
          style={{
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          Generates a fresh X25519 device keypair, wraps a random 32-byte family key using
          crypto_box_seal, then unwraps and verifies equality. 80-byte sealed envelope.
        </p>
      </div>

      <RunButton label="Run Demo 2" onClick={handleRun} running={state.status === "running"} />

      {state.status === "done" && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              marginBottom: "var(--space-3)",
            }}
          >
            <PassChip ok={state.result.ok} />
            <TimingBadge ms={state.result.ms} />
          </div>
          <div style={{ marginBottom: "var(--space-2)" }}>
            <div style={labelStyle}>Envelope ({state.result.envelopeLen} bytes)</div>
            <div style={monoStyle}>{truncHex(state.result.envelopeHex)}</div>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div
          style={{
            marginTop: "var(--space-3)",
            color: "var(--color-expense)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
          }}
        >
          Error: {state.message}
        </div>
      )}
    </div>
  );
}

function Demo3Card() {
  const [state, setState] = useState<DemoState<Demo3Result>>({ status: "idle" });

  async function handleRun() {
    setState({ status: "running" });
    try {
      const result = await runArgon();
      setState({ status: "done", result });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <h2
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-subheading)",
            color: "var(--color-text)",
            margin: 0,
            marginBottom: "var(--space-2)",
          }}
        >
          Demo 3: Argon2id recovery key derivation
        </h2>
        <p
          style={{
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          Derives a 32-byte key from a fixed 12-word BIP39 phrase. Target: 400–800 ms. Timing is
          color-coded: green = good, yellow = borderline, red = out of range.
        </p>
      </div>

      <div
        style={{
          marginBottom: "var(--space-3)",
          padding: "var(--space-3)",
          background: "var(--color-surface-raised)",
          borderRadius: 8,
        }}
      >
        <div style={labelStyle}>Fixed phrase (read-only)</div>
        <div style={{ ...monoStyle, color: "var(--color-text)", fontSize: 13 }}>{FIXED_PHRASE}</div>
      </div>

      <RunButton label="Run Demo 3" onClick={handleRun} running={state.status === "running"} />

      {state.status === "running" && (
        <p
          style={{
            marginTop: "var(--space-3)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
          }}
        >
          Argon2id running (may take 400–800 ms)…
        </p>
      )}

      {state.status === "done" && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              marginBottom: "var(--space-3)",
            }}
          >
            <PassChip ok={state.result.ok} />
            <TimingBadge ms={state.result.ms} colored />
          </div>
          <div style={{ marginBottom: "var(--space-2)" }}>
            <div style={labelStyle}>Derived key (32 bytes)</div>
            <div style={monoStyle}>{truncHex(state.result.keyHex)}</div>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div
          style={{
            marginTop: "var(--space-3)",
            color: "var(--color-expense)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
          }}
        >
          Error: {state.message}
        </div>
      )}
    </div>
  );
}

function Demo4Card() {
  const [state, setState] = useState<DemoState<Demo4VectorResult[]>>({ status: "idle" });

  async function handleRun() {
    setState({ status: "running" });
    try {
      const results = await runAADVectors();
      setState({ status: "done", result: results });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const passCount = state.status === "done" ? state.result.filter((r) => r.ok).length : 0;
  const failCount = state.status === "done" ? state.result.filter((r) => !r.ok).length : 0;
  const allPass = state.status === "done" && failCount === 0;

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <h2
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-subheading)",
            color: "var(--color-text)",
            margin: 0,
            marginBottom: "var(--space-2)",
          }}
        >
          Demo 4: AAD golden vectors ({vectors.vectors.length} vectors)
        </h2>
        <p
          style={{
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          Runs serializeAAD on each golden vector and compares to the expected hex produced by the
          Go backend. Verifies cross-language byte identity.
        </p>
      </div>

      <RunButton label="Run Demo 4" onClick={handleRun} running={state.status === "running"} />

      {state.status === "done" && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              marginBottom: "var(--space-4)",
            }}
          >
            <PassChip ok={allPass} />
            <span
              style={{
                fontFamily: "DM Sans, sans-serif",
                fontSize: "var(--text-body)",
                color: "var(--color-text-secondary)",
              }}
            >
              {passCount}/{vectors.vectors.length} passed
              {failCount > 0 && (
                <span style={{ color: "var(--color-expense)", marginLeft: 8 }}>
                  {failCount} failed
                </span>
              )}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {state.result.map((r) => (
              <div
                key={r.name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--color-surface-raised)",
                  borderRadius: 6,
                  borderLeft: `3px solid ${r.ok ? "var(--color-income)" : "var(--color-expense)"}`,
                }}
              >
                <span
                  style={{
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "var(--text-caption)",
                    color: r.ok ? "var(--color-income)" : "var(--color-expense)",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {r.ok ? "✓" : "✗"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: "var(--text-caption)",
                      color: "var(--color-text)",
                      marginBottom: r.ok ? 0 : 4,
                    }}
                  >
                    {r.name}
                  </div>
                  {!r.ok && (
                    <>
                      <div style={{ ...monoStyle, fontSize: 11, marginBottom: 2 }}>
                        <span style={{ color: "var(--color-expense)" }}>got:&nbsp;</span>
                        {truncHex(r.got ?? "")}
                      </div>
                      <div style={{ ...monoStyle, fontSize: 11 }}>
                        <span style={{ color: "var(--color-text-secondary)" }}>exp:&nbsp;</span>
                        {truncHex(r.expected ?? "")}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div
          style={{
            marginTop: "var(--space-3)",
            color: "var(--color-expense)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: "var(--text-caption)",
          }}
        >
          Error: {state.message}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CryptoDemoPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--color-bg)",
        padding: "var(--space-6)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div
          style={{
            marginBottom: "var(--space-6)",
            paddingBottom: "var(--space-5)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <h1
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 700,
              fontSize: "var(--text-heading)",
              color: "var(--color-primary)",
              margin: 0,
              marginBottom: "var(--space-2)",
            }}
          >
            Crypto Demo
          </h1>
          <p
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
              margin: 0,
            }}
          >
            DEV ONLY — per architecture.md §12 Phase 2 DoD. Route: /dev/crypto-demo. Each demo runs
            on button click only.
          </p>
        </div>

        <Demo1Card />
        <Demo2Card />
        <Demo3Card />
        <Demo4Card />
      </div>
    </div>
  );
}
