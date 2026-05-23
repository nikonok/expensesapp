// Settings → Security section (architecture §9.6, Phase 6c).
//
// Sections:
//   1. Active devices  — list with per-device "Sign out" via ActiveDevicesList
//   2. Show recovery code  — reauth → decrypt Envelope B → display 24-word phrase
//   3. Regenerate recovery code  — confirm → reauth → generate new phrase + envelopes

import { useState, useEffect, useRef } from "react";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { requestReauthGrant } from "@/services/auth/reauth";
import { revealRecoveryPhrase } from "@/services/account/recovery-client";
import { getLocalFamilyId } from "@/services/family/active-family";
import { apiFetch } from "@/services/auth/client";
import { ActiveDevicesList } from "./ActiveDevicesList";

/** Clear the clipboard after this many milliseconds. */
const CLIPBOARD_CLEAR_MS = 30_000;

/** Encode a Uint8Array to base64url (no padding). */
function toB64u(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Derive the 16-byte Argon2 salt via HKDF-SHA256 (mirrors family/init.ts). */
async function deriveArgon2Salt(familyId: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(familyId),
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: enc.encode("argon2-recovery-v1"),
    },
    keyMaterial,
    128,
  );
  return new Uint8Array(bits);
}

export function SecuritySettings() {
  const { show: showToast } = useToast();

  // ── Show recovery phrase ─────────────────────────────────────────────────────
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealedPhrase, setRevealedPhrase] = useState<string | null>(null);
  const clearClipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearClipboardTimerRef.current !== null) {
        clearTimeout(clearClipboardTimerRef.current);
      }
    };
  }, []);

  async function handleShowRecoveryCode() {
    setRevealLoading(true);
    try {
      const familyId = await getLocalFamilyId();
      if (!familyId) {
        showToast("No family synced yet — cannot reveal phrase", "error");
        return;
      }
      const { grantId } = await requestReauthGrant();
      const phrase = await revealRecoveryPhrase(grantId, familyId);
      setRevealedPhrase(phrase);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reveal recovery code", "error");
    } finally {
      setRevealLoading(false);
    }
  }

  async function handleCopyPhrase() {
    if (!revealedPhrase) return;
    try {
      await navigator.clipboard.writeText(revealedPhrase);
      showToast("Copied — will clear in 30s", "success");
      if (clearClipboardTimerRef.current !== null) clearTimeout(clearClipboardTimerRef.current);
      clearClipboardTimerRef.current = setTimeout(() => {
        navigator.clipboard.writeText("").catch(() => {});
        clearClipboardTimerRef.current = null;
      }, CLIPBOARD_CLEAR_MS);
    } catch {
      showToast("Failed to copy", "error");
    }
  }

  // ── Regenerate recovery code ─────────────────────────────────────────────────
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  async function handleRegenConfirm() {
    setRegenConfirmOpen(false);
    setRegenLoading(true);
    try {
      const familyId = await getLocalFamilyId();
      if (!familyId) {
        showToast("No family synced yet — cannot regenerate", "error");
        return;
      }

      const { grantId } = await requestReauthGrant();

      // Generate new phrase — all entropy from @scure/bip39 (256-bit = 24 words).
      const newPhrase = bip39.generateMnemonic(wordlist, 256);

      // Dynamic import keeps the Web Worker bundle out of the initial chunk.
      const { cryptoWorker } = await import("@/services/crypto/worker-client");

      const [salt, { wrapBytes, phraseCt }] = await Promise.all([
        deriveArgon2Salt(familyId),
        // Worker wraps Envelope A + B using the stored familyKey (never exposed).
        cryptoWorker.regenerateRecoveryEnvelopes(newPhrase, familyId, new Date().toISOString()),
      ]);

      await apiFetch("/api/v1/account/recovery/regenerate", {
        method: "POST",
        headers: { "X-Reauth-Grant": grantId },
        body: JSON.stringify({
          wrap: toB64u(wrapBytes),
          phraseCt: toB64u(phraseCt),
          salt: toB64u(salt),
        }),
      });

      showToast("Recovery code regenerated", "success");
      setRevealedPhrase(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to regenerate recovery code", "error");
    } finally {
      setRegenLoading(false);
    }
  }

  return (
    <div>
      {/* Active devices */}
      <ActiveDevicesList />

      {/* Show recovery code */}
      {!revealedPhrase ? (
        <button
          onClick={handleShowRecoveryCode}
          disabled={revealLoading}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: "52px",
            width: "100%",
            padding: "0 var(--space-4)",
            background: "none",
            border: "none",
            borderBottom: "1px solid var(--color-border)",
            cursor: revealLoading ? "not-allowed" : "pointer",
            opacity: revealLoading ? 0.6 : 1,
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
            }}
          >
            {revealLoading ? "Verifying…" : "Show recovery code"}
          </span>
        </button>
      ) : (
        <div
          style={{
            padding: "var(--space-4)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-muted)",
              margin: "0 0 var(--space-3)",
            }}
          >
            Recovery code — store it somewhere safe
          </p>

          {/* 4-column word grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "var(--space-2)",
              marginBottom: "var(--space-3)",
            }}
          >
            {revealedPhrase.split(" ").map((word, i) => (
              <div
                key={i}
                style={{
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-card)",
                  padding: "var(--space-2) var(--space-1)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  minHeight: 48,
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: "var(--text-caption)",
                    color: "var(--color-text-disabled)",
                    lineHeight: 1,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontWeight: 500,
                    fontSize: "0.65rem",
                    color: "var(--color-text)",
                    wordBreak: "break-all",
                    textAlign: "center",
                    lineHeight: 1.2,
                  }}
                >
                  {word}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <button
              onClick={handleCopyPhrase}
              style={{
                flex: 1,
                minHeight: "44px",
                background: "var(--color-primary)",
                color: "var(--color-bg)",
                border: "none",
                borderRadius: "var(--radius-btn)",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
                cursor: "pointer",
              }}
            >
              Copy
            </button>
            <button
              onClick={() => setRevealedPhrase(null)}
              style={{
                flex: 1,
                minHeight: "44px",
                background: "var(--color-surface-raised)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-btn)",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
                cursor: "pointer",
              }}
            >
              Hide
            </button>
          </div>
        </div>
      )}

      {/* Regenerate recovery code */}
      <button
        onClick={() => setRegenConfirmOpen(true)}
        disabled={regenLoading}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          width: "100%",
          padding: "0 var(--space-4)",
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          cursor: regenLoading ? "not-allowed" : "pointer",
          opacity: regenLoading ? 0.6 : 1,
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
            color: "var(--color-text)",
          }}
        >
          {regenLoading ? "Regenerating…" : "Regenerate recovery code"}
        </span>
      </button>

      <ConfirmDialog
        isOpen={regenConfirmOpen}
        title="Regenerate recovery code"
        body="This will invalidate your current recovery code and create a new one. Make sure to save the new code."
        confirmLabel="Regenerate"
        onConfirm={handleRegenConfirm}
        onCancel={() => setRegenConfirmOpen(false)}
        variant="destructive"
      />
    </div>
  );
}
