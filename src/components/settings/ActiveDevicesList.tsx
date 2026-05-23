// List of active devices shown in Settings → Security.
// Fetches GET /api/v1/me/devices, filters to status="active", and renders each
// with a "Sign out" button that calls POST /api/v1/me/devices/{id}/revoke.
// The current device (matched by auth store device.id) gets a "This device" tag
// and requires confirmation before sign-out (which also redirects to sign-in).

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { apiFetch } from "@/services/auth/client";
import { useAuthStore } from "@/services/auth/session";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface DeviceItem {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  lastSeenAt?: string | null;
}

export function ActiveDevicesList() {
  const { show: showToast } = useToast();
  const navigate = useNavigate();
  const currentDeviceId = useAuthStore((s) => s.device?.id);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmSelfSignOut, setConfirmSelfSignOut] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const items = await apiFetch<DeviceItem[]>("/api/v1/me/devices");
      setDevices(items.filter((d) => d.status === "active"));
    } catch {
      showToast("Failed to load devices", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  async function revokeDevice(deviceId: string) {
    setRevoking(deviceId);
    try {
      await apiFetch(`/api/v1/me/devices/${deviceId}/revoke`, { method: "POST" });
      showToast("Device signed out", "success");
      if (deviceId === currentDeviceId) {
        // Sign out of current device → go to sign-in screen.
        useAuthStore.getState().signOut();
        navigate("/signin", { replace: true });
      } else {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      }
    } catch {
      showToast("Failed to sign out device", "error");
    } finally {
      setRevoking(null);
    }
  }

  function handleRevoke(deviceId: string) {
    if (deviceId === currentDeviceId) {
      setConfirmSelfSignOut(true);
    } else {
      revokeDevice(deviceId);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          padding: "var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-muted)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-muted)",
        }}
      >
        No active devices
      </div>
    );
  }

  return (
    <div>
      {devices.map((device) => {
        const isCurrent = device.id === currentDeviceId;
        return (
          <div
            key={device.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: "52px",
              padding: "var(--space-3) var(--space-4)",
              borderBottom: "1px solid var(--color-border)",
              gap: "var(--space-3)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontWeight: 500,
                    fontSize: "var(--text-body)",
                    color: "var(--color-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {device.label}
                </span>
                {isCurrent && (
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: "var(--text-caption)",
                      color: "var(--color-primary)",
                      background: "oklch(72% 0.22 210 / 12%)",
                      border: "1px solid oklch(72% 0.22 210 / 30%)",
                      borderRadius: 4,
                      padding: "1px 6px",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    This device
                  </span>
                )}
              </div>
              {device.lastSeenAt && (
                <div
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: "var(--text-caption)",
                    color: "var(--color-text-muted)",
                    marginTop: 2,
                  }}
                >
                  Last seen {new Date(device.lastSeenAt).toLocaleDateString()}
                </div>
              )}
            </div>

            <button
              onClick={() => handleRevoke(device.id)}
              disabled={revoking === device.id}
              aria-label={
                isCurrent ? `Sign out of this device (${device.label})` : `Sign out ${device.label}`
              }
              style={{
                background: "none",
                border: "1px solid var(--color-expense)",
                borderRadius: 6,
                padding: "var(--space-1) var(--space-3)",
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-expense)",
                cursor: revoking === device.id ? "not-allowed" : "pointer",
                opacity: revoking === device.id ? 0.5 : 1,
                minHeight: 32,
                minWidth: 44,
                flexShrink: 0,
              }}
            >
              {revoking === device.id ? "…" : isCurrent ? "Sign out (this device)" : "Sign out"}
            </button>
          </div>
        );
      })}

      <ConfirmDialog
        isOpen={confirmSelfSignOut}
        title="Sign out of this device"
        body="You are about to sign out of this device. Continue?"
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirmSelfSignOut(false);
          if (currentDeviceId) revokeDevice(currentDeviceId);
        }}
        onCancel={() => setConfirmSelfSignOut(false)}
        variant="destructive"
      />
    </div>
  );
}
