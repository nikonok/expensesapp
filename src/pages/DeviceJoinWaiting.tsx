// Full-screen waiting view — shown when the user signed in on a new device
// and the response carried `awaitingEnvelope: true`.
//
// Shows "Waiting for approval…" with a pulse animation.
// After 30s, replaces the waiting UI with RecoveryCodeEntry (§8.2 timeout branch).
// Architecture §8.2, Phase 5e / Phase 6d.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/services/auth/session";
import { apiFetch } from "@/services/auth/client";
import { useSettingsStore } from "@/stores/settings-store";
import { logger } from "@/services/log.service";
import { RecoveryCodeEntry } from "@/components/onboarding/RecoveryCodeEntry";

export default function DeviceJoinWaiting() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showRecovery, setShowRecovery] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const awaitingEnvelope = useAuthStore((s) => s.awaitingEnvelope);
  const device = useAuthStore((s) => s.device);
  const [wasAwaiting, setWasAwaiting] = useState(awaitingEnvelope);
  // Fingerprint of THIS device's own pubkey — shown so the approver can
  // compare it against the same fingerprint rendered next to Approve/Reject
  // on their device (DeviceJoinedBanner). Same derivation, same input pubkey.
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const selfActivationAttempted = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowRecovery(true), 30_000);
    return () => clearTimeout(timer);
  }, []);

  // Fingerprint display + self-activation attempt.
  //
  // Self-activation: a device that already holds the familyKey (e.g. a
  // re-sign-in minted a new pending device row for a user who is already an
  // active family member) doesn't need another device's approval — it can
  // wrap the stored familyKey for its own pubkey and upload it itself.
  //
  // Backend authorization (verified against backend/internal/family/devices.go
  // PostDeviceEnvelope): the envelope endpoint only requires the UPLOADER to
  // be an active family member (`GetActiveFamilyMember`, independent of the
  // TARGET device's own status) and the target device to be pending in the
  // same family. It does not require the caller's own device to be active,
  // so a pending device whose user is already an active member is allowed to
  // upload its own envelope. A genuinely new device (no stored familyKey yet)
  // simply gets "NoStoredFamilyKey" from the worker and falls through to the
  // normal wait-for-approval UI below.
  useEffect(() => {
    if (!device?.id) return;
    let cancelled = false;

    void (async () => {
      try {
        const { cryptoWorker } = await import("@/services/crypto/worker-client");
        // Fetch pub key via the list endpoint (no single-device GET exists) —
        // this is the exact pubkey the server (and therefore the approving
        // device's SSE payload) has on file for us.
        const allDevices = await apiFetch<{ id: string; pubKey: string }[]>("/api/v1/me/devices");
        const devInfo = allDevices.find((d) => d.id === device.id);
        if (!devInfo || cancelled) return;

        try {
          const fp = await cryptoWorker.fingerprintPublicKey(devInfo.pubKey);
          if (!cancelled) setFingerprint(fp);
        } catch (err) {
          logger.warn(
            "deviceJoin.fingerprint.failed",
            err instanceof Error ? err : new Error(String(err)),
          );
        }

        if (!awaitingEnvelope || selfActivationAttempted.current) return;
        selfActivationAttempted.current = true;

        const envelopeB64u = await cryptoWorker.wrapStoredFamilyKeyForDevice(devInfo.pubKey);
        if (cancelled) return;
        await apiFetch(`/api/v1/family/devices/${device.id}/envelope`, {
          method: "POST",
          body: JSON.stringify({ envelope: envelopeB64u }),
        });
        if (cancelled) return;

        useAuthStore.getState().clearAwaitingEnvelope();
        await useSettingsStore.getState().update("hasCompletedOnboarding", true);
        navigate("/accounts", { replace: true });
      } catch (err) {
        // Expected for a genuinely new device (no stored familyKey yet, or
        // the uploader isn't actually an active family member) — swallow and
        // let the normal wait-for-approval UI stand.
        logger.info("deviceJoin.selfActivate.skipped", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [device?.id, awaitingEnvelope, navigate]);

  // Track when we first render with awaitingEnvelope=true.
  useEffect(() => {
    if (awaitingEnvelope) setWasAwaiting(true);
  }, [awaitingEnvelope]);

  // Navigate to the main app once the family key has been received and persisted
  // (awaitingEnvelope transitions from true → false). This device is joining
  // an existing family — it inherits family data and must never run
  // onboarding (which would re-seed default categories/accounts).
  useEffect(() => {
    if (wasAwaiting && !awaitingEnvelope) {
      void useSettingsStore.getState().update("hasCompletedOnboarding", true);
      navigate("/accounts", { replace: true });
    }
  }, [wasAwaiting, awaitingEnvelope, navigate]);

  async function handleSignOut() {
    await useAuthStore.getState().signOut();
    navigate("/signin", { replace: true });
  }

  async function handleRecoverySubmit(phrase: string) {
    setRecovering(true);
    setRecoveryError(null);
    try {
      // 1. GET /api/v1/family/recovery-envelope → {recoveryWrap, salt, version,
      //    familyId, createdAt}. The backend includes familyId + createdAt so a
      //    cold-recovery device can derive the AAD without an extra /v1/me
      //    round-trip (B9).
      const envelope = await apiFetch<{
        recoveryWrap: string;
        salt: string;
        version: number;
        familyId?: string;
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
      const createdAt = envelope.createdAt ?? "";

      // Dynamic import keeps the crypto worker out of the initial chunk.
      const { cryptoWorker } = await import("@/services/crypto/worker-client");

      // Prefer the familyId from the recovery-envelope response. On a fresh
      // device the sync-cursor table is empty, so we'd otherwise need an extra
      // round-trip to GET /v1/me. Fall back to the cursor for old clients that
      // happen to have pulled before the recovery flow (defensive only).
      let familyId = envelope.familyId ?? "";
      if (!familyId) {
        const { db } = await import("@/db/database");
        const cursor = await db.syncCursors.toCollection().first();
        familyId = cursor?.familyId ?? "";
      }

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

      // Seed the canonical local familyId immediately — a cold-recovery
      // device has never pulled yet, so `syncCursors` has no row and
      // `getLocalFamilyId()` would otherwise return null until the first
      // successful pull.
      const { setLocalFamilyId } = await import("@/services/family/active-family");
      await setLocalFamilyId(familyId);

      // 3. Self-upload: wrap stored familyKey for our own device pub key and POST it.
      if (device?.id) {
        // Fetch pub key via the list endpoint (no single-device GET exists).
        const allDevices = await apiFetch<{ id: string; pubKey: string }[]>("/api/v1/me/devices");
        const devInfo = allDevices.find((d) => d.id === device.id);
        if (!devInfo) {
          throw new Error(`Device ${device.id} not found in device list.`);
        }
        const envelopeB64u = await cryptoWorker.wrapStoredFamilyKeyForDevice(devInfo.pubKey);
        await apiFetch(`/api/v1/family/devices/${device.id}/envelope`, {
          method: "POST",
          body: JSON.stringify({ envelope: envelopeB64u }),
        });
      }

      // 4. Mark that we're no longer awaiting an envelope.
      useAuthStore.getState().clearAwaitingEnvelope();

      // This device recovered access to an existing family — it must never
      // run onboarding (which would re-seed default categories/accounts).
      await useSettingsStore.getState().update("hasCompletedOnboarding", true);

      // Navigate to main app.
      navigate("/accounts", { replace: true });
    } catch (err) {
      logger.warn(
        "deviceJoin.recovery.submit.failed",
        err instanceof Error ? err : new Error(String(err)),
      );
      setRecoveryError(t("devices.joinWaiting.recoveryFailed"));
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
          {t("devices.joinWaiting.recoverAccessTitle")}
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
          {t("devices.joinWaiting.recoverAccessSubtitle")}
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
          {t("devices.joinWaiting.waitForApproval")}
        </button>

        <button
          onClick={() => void handleSignOut()}
          style={{
            background: "none",
            border: "none",
            padding: "var(--space-2) var(--space-4)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-disabled)",
            cursor: "pointer",
            minHeight: 44,
          }}
        >
          {t("devices.joinWaiting.signOut")}
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
        {t("devices.joinWaiting.title")}
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
        {t("devices.joinWaiting.subtitle")}
      </p>

      {fingerprint && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-1)",
            marginBottom: "var(--space-8)",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
            maxWidth: 320,
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-muted)",
            }}
          >
            {t("devices.joinWaiting.fingerprintLabel")}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
              letterSpacing: "0.06em",
              wordBreak: "break-all",
            }}
            data-testid="own-device-fingerprint"
          >
            {fingerprint}
          </span>
        </div>
      )}

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
        {t("devices.joinWaiting.enterRecoveryCode")}
      </button>

      <button
        onClick={() => void handleSignOut()}
        style={{
          background: "none",
          border: "none",
          padding: "var(--space-2) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-disabled)",
          cursor: "pointer",
          minHeight: 44,
          minWidth: 44,
        }}
      >
        {t("devices.joinWaiting.signOut")}
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
