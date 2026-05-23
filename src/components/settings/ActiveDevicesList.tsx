// List of active devices shown in Settings → Security.
// Fetches GET /api/v1/me/devices, filters to status="active", and renders each
// with a "Sign out" button that calls POST /api/v1/me/devices/{id}/revoke.

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/services/auth/client";
import { useToast } from "@/components/shared/Toast";

interface DeviceItem {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  lastSeenAt?: string | null;
}

export function ActiveDevicesList() {
  const { show: showToast } = useToast();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

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

  async function handleRevoke(deviceId: string) {
    setRevoking(deviceId);
    try {
      await apiFetch(`/api/v1/me/devices/${deviceId}/revoke`, { method: "POST" });
      showToast("Device signed out", "success");
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch {
      showToast("Failed to sign out device", "error");
    } finally {
      setRevoking(null);
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
      {devices.map((device) => (
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
            aria-label={`Sign out ${device.label}`}
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
            {revoking === device.id ? "…" : "Sign out"}
          </button>
        </div>
      ))}
    </div>
  );
}
