// Banner shown on existing devices when a `device.joined` SSE event arrives.
// Architecture §8.2, Phase 5e / Phase 6c (revoke wired).
//
// Reads from useDeviceJoinStore. The Revoke action calls POST /v1/me/devices/{id}/revoke.

import { useState } from "react";
import { useDeviceJoinStore } from "@/stores/device-join-store";
import { apiFetch } from "@/services/auth/client";
import { useToast } from "./Toast";

export function DeviceJoinedBanner() {
  const { pendingDeviceJoin, clear } = useDeviceJoinStore();
  const { show: showToast } = useToast();
  const [revoking, setRevoking] = useState(false);

  if (!pendingDeviceJoin) return null;

  async function handleRevoke() {
    if (revoking) return;
    setRevoking(true);
    try {
      await apiFetch(`/api/v1/me/devices/${pendingDeviceJoin!.deviceId}/revoke`, {
        method: "POST",
      });
      showToast("Device revoked", "success");
      clear();
    } catch {
      showToast("Failed to revoke device", "error");
    } finally {
      setRevoking(false);
    }
  }

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
          New device joined: <strong style={{ fontWeight: 500 }}>{pendingDeviceJoin.label}</strong>
        </span>

        {/* Dismiss */}
        <button
          onClick={clear}
          aria-label="Dismiss"
          style={{
            background: "none",
            border: "none",
            padding: "var(--space-1)",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            minHeight: 44,
            minWidth: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-muted)",
          }}
        >
          This wasn&apos;t me →
        </span>
        <button
          onClick={handleRevoke}
          disabled={revoking}
          style={{
            background: "none",
            border: "1px solid var(--color-expense)",
            borderRadius: 6,
            padding: "var(--space-1) var(--space-3)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-expense)",
            cursor: revoking ? "not-allowed" : "pointer",
            opacity: revoking ? 0.5 : 1,
            minHeight: 32,
            minWidth: 44,
          }}
        >
          {revoking ? "…" : "Revoke"}
        </button>
      </div>
    </div>
  );
}
