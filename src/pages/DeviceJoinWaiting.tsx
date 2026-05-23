// Full-screen waiting view — shown when the user signed in on a new device
// and the response carried `awaitingEnvelope: true`.
//
// Shows "Waiting for approval…" with a pulse animation.
// After 30s, replaces the waiting UI with RecoveryCodeEntry (§8.2 timeout branch).
// Architecture §8.2, Phase 5e / Phase 6d.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuthStore } from "@/services/auth/session";
import { apiFetch } from "@/services/auth/client";
import { RecoveryCodeEntry } from "@/components/onboarding/RecoveryCodeEntry";

export default function DeviceJoinWaiting() {
  const navigate = useNavigate();
  const [showRecovery, setShowRecovery] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const awaitingEnvelope = useAuthStore((s) => s.awaitingEnvelope);
  const device = useAuthStore((s) => s.device);
  const [wasAwaiting, setWasAwaiting] = useState(awaitingEnvelope);

  useEffect(() => {
    const timer = setTimeout(() => setShowRecovery(true), 30_000);
    return () => clearTimeout(timer);
  }, []);

  // Track when we first render with awaitingEnvelope=true.
  useEffect(() => {
    if (awaitingEnvelope) setWasAwaiting(true);
  }, [awaitingEnvelope]);

  // Navigate to the main app once the family key has been received and persisted
  // (awaitingEnvelope transitions from true → false).
  useEffect(() => {
    if (wasAwaiting && !awaitingEnvelope) {
      navigate("/accounts", { replace: true });
    }
  }, [wasAwaiting, awaitingEnvelope, navigate]);

  async function handleRecoverySubmit(phrase: string) {
    setRecovering(true);
    setRecoveryError(null);
    try {
      // 1. GET /api/v1/family/recovery-envelope → {recoveryWrap, salt, version, createdAt?}
      const envelope = await apiFetch<{
        recoveryWrap: string;
        salt: string;
        version: number;
        createdAt?: string;
      }>("/api/v1/family/recovery-envelope");

      // Decode base64url → Uint8Array helper.
      function fromB64u(str: string): Uint8Array {
        const padded = str.replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (padded.length % 4)) % 4;
        const b64 = padded + "=".repeat(padLen);
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      const recoveryWrap = fromB64u(envelope.recoveryWrap);
      // familyId for AAD is derived from the sync cursor table (populated after first pull).
      // During recovery, we use the phrase to unwrap; the worker handles deriving familyId
      // from context — we pass it explicitly.
      // The familyId is needed for the AAD; obtain it from the server context.
      // Since we don't have it locally yet (fresh device), use the createdAt from the envelope.
      const createdAt = envelope.createdAt ?? "";

      // Dynamic import keeps the crypto worker out of the initial chunk.
      const { cryptoWorker } = await import("@/services/crypto/worker-client");

      // We need familyId to unwrap. GET /api/v1/family/recovery-envelope requires
      // a session+family_member, meaning the backend set familyId in the context.
      // The familyId must come from the backend response or we can derive it from
      // GET /api/v1/me (but currently family is nil). Use a dedicated recovery endpoint
      // that includes familyId, or fall back to reading from the server-side context.
      //
      // For the recovery unwrap, we call unwrapRecoveryEnvelopeAndPersist which internally
      // calls deriveRecoveryKey (Argon2id) using phrase + familyId. The familyId is obtained
      // from an additional GET /api/v1/me/family or similar.
      //
      // Short-term: GET /api/v1/family/recovery-envelope and extract familyId from the session.
      // The backend auth middleware sets familyId on the context from the user's session,
      // but the response JSON doesn't expose it. We need a way to get it.
      //
      // Pragmatic solution: POST to a recovery-initiate endpoint or use the family endpoint.
      // Since the spec for this endpoint only returns {recoveryWrap, salt, version},
      // we request familyId from the separate GET /api/v1/me endpoint through family info.
      // For now we use the sync cursor table when available, otherwise the server returns it
      // in the recovery-envelope response when the 6b backend adds it.
      //
      // Retrieve familyId: try sync cursors first, then use server response field.
      const { db } = await import("@/db/database");
      const cursor = await db.syncCursors.toCollection().first();
      const familyId = cursor?.familyId ?? (envelope as { familyId?: string }).familyId ?? "";

      if (!familyId) {
        throw new Error("Could not determine family ID for recovery. Please try again.");
      }

      // 2. Unwrap Envelope A inside the worker + persist familyKey.
      await cryptoWorker.unwrapRecoveryEnvelopeAndPersist(
        recoveryWrap,
        phrase,
        familyId,
        createdAt,
      );

      // 3. Self-upload: wrap stored familyKey for our own device pub key and POST it.
      if (device?.id) {
        // Fetch our device pub key from the server.
        const devInfo = await apiFetch<{ pubKey: string }>(`/api/v1/me/devices/${device.id}`);
        const envelopeB64u = await cryptoWorker.wrapStoredFamilyKeyForDevice(devInfo.pubKey);
        await apiFetch(`/api/v1/family/devices/${device.id}/envelope`, {
          method: "POST",
          body: JSON.stringify({ envelope: envelopeB64u }),
        });
      }

      // 4. Mark that we're no longer awaiting an envelope.
      useAuthStore.getState().clearAwaitingEnvelope();

      // Navigate to main app.
      navigate("/accounts", { replace: true });
    } catch (err) {
      setRecoveryError(
        err instanceof Error ? err.message : "Recovery failed. Check your words and try again.",
      );
    } finally {
      setRecovering(false);
    }
  }

  if (showRecovery) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          height: "100dvh",
          background: "var(--color-bg)",
          padding: "var(--space-6)",
          overflowY: "auto",
        }}
      >
        <h1
          style={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-title)",
            color: "var(--color-text)",
            margin: "0 0 var(--space-3)",
            alignSelf: "flex-start",
          }}
        >
          Recover access
        </h1>

        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-muted)",
            margin: "0 0 var(--space-5)",
            lineHeight: 1.5,
            alignSelf: "flex-start",
          }}
        >
          Enter your 24-word recovery code to restore access to your data.
        </p>

        {recoveryError && (
          <div
            role="alert"
            style={{
              background: "var(--color-expense-dim)",
              border: "1px solid var(--color-expense)",
              borderRadius: "var(--radius-card)",
              padding: "var(--space-3) var(--space-4)",
              marginBottom: "var(--space-4)",
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-body)",
              color: "var(--color-expense)",
              width: "100%",
            }}
          >
            {recoveryError}
          </div>
        )}

        <RecoveryCodeEntry onSubmit={handleRecoverySubmit} disabled={recovering} />

        <button
          onClick={() => setShowRecovery(false)}
          style={{
            background: "none",
            border: "none",
            padding: "var(--space-3) var(--space-4)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            marginTop: "var(--space-4)",
            textDecoration: "underline",
            minHeight: 44,
          }}
        >
          Wait for approval instead
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        background: "var(--color-bg)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      {/* Pulse animation */}
      <div
        style={{
          position: "relative",
          width: 72,
          height: 72,
          marginBottom: "var(--space-6)",
        }}
      >
        {/* Outer ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2px solid var(--color-primary)",
            opacity: 0.3,
            animation: "pulse-ring 2s ease-out infinite",
          }}
        />
        {/* Inner dot */}
        <div
          style={{
            position: "absolute",
            inset: 12,
            borderRadius: "50%",
            background: "var(--color-primary)",
            opacity: 0.8,
            animation: "pulse-dot 2s ease-in-out infinite",
          }}
        />
      </div>

      <h1
        style={{
          fontFamily: '"Syne", sans-serif',
          fontWeight: 700,
          fontSize: "var(--text-title)",
          color: "var(--color-text)",
          margin: 0,
          marginBottom: "var(--space-3)",
        }}
      >
        Waiting for approval
      </h1>

      <p
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-muted)",
          margin: 0,
          marginBottom: "var(--space-8)",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        Open the app on one of your other devices to approve this sign-in.
      </p>

      <button
        onClick={() => setShowRecovery(true)}
        style={{
          background: "none",
          border: "none",
          padding: "var(--space-2) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-primary)",
          cursor: "pointer",
          textDecoration: "underline",
          minHeight: 44,
          minWidth: 44,
        }}
      >
        Enter recovery code instead
      </button>

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.9); opacity: 0.5; }
          70% { transform: scale(1.3); opacity: 0; }
          100% { transform: scale(1.3); opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { transform: scale(0.9); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
