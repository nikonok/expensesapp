// List of active devices shown in Settings → Security.
// Fetches GET /api/v1/me/devices, filters to status="active", and renders each
// with a "Sign out" button that calls POST /api/v1/me/devices/{id}/revoke.
// The current device (matched by auth store device.id) gets a "This device" tag
// and requires confirmation before sign-out (which also redirects to sign-in).

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { show: showToast } = useToast();
  const navigate = useNavigate();
  const currentDeviceId = useAuthStore((s) => s.device?.id);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmSelfSignOut, setConfirmSelfSignOut] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const items = await apiFetch<DeviceItem[]>("/api/v1/me/devices");
      setDevices(items.filter((d) => d.status === "active"));
    } catch {
      showToast(t("devices.active.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  async function revokeDevice(deviceId: string) {
    setRevoking(deviceId);
    try {
      await apiFetch(`/api/v1/me/devices/${deviceId}/revoke`, { method: "POST" });
      showToast(t("devices.active.signOutSuccess"), "success");
      if (deviceId === currentDeviceId) {
        // Sign out of current device → go to sign-in screen.
        await useAuthStore.getState().signOut();
        navigate("/signin", { replace: true });
      } else {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      }
    } catch {
      showToast(t("devices.active.signOutFailed"), "error");
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

  // B8 — call POST /v1/auth/signout-all which revokes every session for this
  // user (across all devices). After it succeeds the current cookie is also
  // gone, so navigate to sign-in.
  async function signOutAll() {
    setSigningOutAll(true);
    try {
      await apiFetch("/api/v1/auth/signout-all", { method: "POST" });
      showToast(t("devices.active.signOutAllSuccess"), "success");
      await useAuthStore.getState().signOut();
      navigate("/signin", { replace: true });
    } catch {
      showToast(t("devices.active.signOutAllFailed"), "error");
    } finally {
      setSigningOutAll(false);
      setConfirmSignOutAll(false);
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
        {t("common.loading")}
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
        {t("devices.active.empty")}
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
                    {t("devices.active.thisDeviceBadge")}
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
                  {t("devices.active.lastSeen", {
                    date: new Date(device.lastSeenAt).toLocaleDateString(),
                  })}
                </div>
              )}
            </div>

            <button
              onClick={() => handleRevoke(device.id)}
              disabled={revoking === device.id}
              aria-label={
                isCurrent
                  ? t("devices.active.ariaSignOutSelf", { label: device.label })
                  : t("devices.active.ariaSignOutOther", { label: device.label })
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
              {revoking === device.id
                ? "…"
                : isCurrent
                  ? t("devices.active.signOutThisDevice")
                  : t("devices.active.signOut")}
            </button>
          </div>
        );
      })}

      {/* B8 — Sign out all devices (calls POST /v1/auth/signout-all) */}
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <button
          onClick={() => setConfirmSignOutAll(true)}
          disabled={signingOutAll}
          aria-label={t("devices.active.signOutAllDevices")}
          style={{
            background: "none",
            border: "1px solid var(--color-expense)",
            borderRadius: 6,
            padding: "var(--space-2) var(--space-3)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-expense)",
            cursor: signingOutAll ? "not-allowed" : "pointer",
            opacity: signingOutAll ? 0.5 : 1,
            minHeight: 44,
          }}
        >
          {signingOutAll
            ? t("devices.active.signingOutAll")
            : t("devices.active.signOutAllDevices")}
        </button>
      </div>

      <ConfirmDialog
        isOpen={confirmSelfSignOut}
        title={t("devices.active.confirmSelfTitle")}
        body={t("devices.active.confirmSelfBody")}
        confirmLabel={t("devices.active.signOut")}
        onConfirm={() => {
          setConfirmSelfSignOut(false);
          if (currentDeviceId) revokeDevice(currentDeviceId);
        }}
        onCancel={() => setConfirmSelfSignOut(false)}
        variant="destructive"
      />

      <ConfirmDialog
        isOpen={confirmSignOutAll}
        title={t("devices.active.confirmAllTitle")}
        body={t("devices.active.confirmAllBody")}
        confirmLabel={t("devices.active.confirmAllLabel")}
        onConfirm={signOutAll}
        onCancel={() => setConfirmSignOutAll(false)}
        variant="destructive"
      />
    </div>
  );
}
