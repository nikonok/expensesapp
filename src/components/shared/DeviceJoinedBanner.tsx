// Banner shown on existing devices when a `device.joined` SSE event arrives.
// Architecture §8.2, Phase 5e / WORK_PLAN.md brief B5a.
//
// Reads from useDeviceJoinStore. The user MUST explicitly Approve before any
// familyKey envelope is wrapped for the joining device — there is no silent
// auto-approve any more (a malicious server can no longer race the user). The
// pubkey fingerprint is shown alongside the device label and user-agent
// excerpt so the user can compare against the joining device's own display.

import { useState } from "react";
import { useDeviceJoinStore } from "@/stores/device-join-store";
import { approveDevice, rejectDevice } from "@/services/sync/engine";
import { useToast } from "./Toast";

export function DeviceJoinedBanner() {
  const { pendingDeviceJoin, clear } = useDeviceJoinStore();
  const { show: showToast } = useToast();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  if (!pendingDeviceJoin) return null;

  const pending = pendingDeviceJoin;

  async function handleApprove() {
    if (busy) return;
    setBusy("approve");
    try {
      await approveDevice(pending.deviceId, pending.pubKey);
      showToast("Device approved", "success");
      clear();
    } catch {
      showToast("Failed to approve device", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleReject() {
    if (busy) return;
    setBusy("reject");
    try {
      await rejectDevice(pending.deviceId);
      showToast("Device rejected", "success");
      clear();
    } catch {
      showToast("Failed to reject device", "error");
    } finally {
      setBusy(null);
    }
  }

  const userAgentExcerpt = pending.userAgent
    ? pending.userAgent.length > 60
      ? pending.userAgent.slice(0, 60) + "…"
      : pending.userAgent
    : null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top) + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: 400,
        width: "calc(100% - 32px)",
        zIndex: "var(--z-toast)",
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        borderLeft: "3px solid var(--color-primary)",
        borderRadius: 12,
        padding: "var(--space-3) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        animation: "toast-in 200ms ease-out forwards",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text)",
            flex: 1,
          }}
        >
          New device joined: <strong style={{ fontWeight: 500 }}>{pending.label}</strong>
        </span>

        {/* Dismiss */}
        <button
          onClick={clear}
          aria-label="Dismiss"
          disabled={busy !== null}
          style={{
            background: "none",
            border: "none",
            padding: "var(--space-1)",
            cursor: busy !== null ? "not-allowed" : "pointer",
            color: "var(--color-text-muted)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            minHeight: 44,
            minWidth: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          ✕
        </button>
      </div>

      {pending.fingerprint && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
            paddingTop: "var(--space-1)",
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-muted)",
            }}
          >
            Verify fingerprint on the joining device:
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
              letterSpacing: "0.06em",
              wordBreak: "break-all",
            }}
            data-testid="device-fingerprint"
          >
            {pending.fingerprint}
          </span>
        </div>
      )}

      {userAgentExcerpt && (
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-muted)",
            wordBreak: "break-word",
          }}
        >
          {userAgentExcerpt}
        </span>
      )}

      <div
        style={{
          display: "flex",
          gap: "var(--space-3)",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingTop: "var(--space-1)",
        }}
      >
        <button
          onClick={handleReject}
          disabled={busy !== null}
          style={{
            background: "none",
            border: "1px solid var(--color-expense)",
            borderRadius: 6,
            padding: "var(--space-2) var(--space-3)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-expense)",
            cursor: busy !== null ? "not-allowed" : "pointer",
            opacity: busy !== null ? 0.5 : 1,
            minHeight: 44,
            minWidth: 88,
          }}
        >
          {busy === "reject" ? "…" : "Reject"}
        </button>
        <button
          onClick={handleApprove}
          disabled={busy !== null}
          style={{
            background: "var(--color-primary)",
            border: "1px solid var(--color-primary)",
            borderRadius: 6,
            padding: "var(--space-2) var(--space-3)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-surface)",
            fontWeight: 500,
            cursor: busy !== null ? "not-allowed" : "pointer",
            opacity: busy !== null ? 0.5 : 1,
            minHeight: 44,
            minWidth: 88,
          }}
        >
          {busy === "approve" ? "…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
