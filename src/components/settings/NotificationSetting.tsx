import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settings-store";
import { useToast } from "../shared/Toast";
import { ensurePushSubscription, disablePush } from "../../services/push/subscribe";
import {
  getNotificationSettings,
  patchNotificationSettings,
  type NotificationSettings,
} from "../../services/notifications/client";

// ── Toggle row ─────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "52px",
        padding: "0 var(--space-4)",
        borderBottom: "1px solid var(--color-border)",
        opacity: disabled ? 0.5 : 1,
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
        {label}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          width: "48px",
          height: "26px",
          borderRadius: "13px",
          background: checked ? "var(--color-primary)" : "var(--color-border)",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background 150ms ease-out",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: checked ? "24px" : "3px",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "var(--color-bg)",
            transition: "left 150ms ease-out",
          }}
        />
      </button>
    </div>
  );
}

// ── Time row ──────────────────────────────────────────────────────────────────

function TimeRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "52px",
        padding: "0 var(--space-4)",
        borderBottom: "1px solid var(--color-border)",
        opacity: disabled ? 0.5 : 1,
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
        {label}
      </span>
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          minHeight: "36px",
          padding: "0 var(--space-3)",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-input)",
          color: "var(--color-text)",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 500,
          fontSize: "var(--text-body)",
          colorScheme: "dark",
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: NotificationSettings = {
  tz: "UTC",
  reminderTime: "20:00",
  dailyReminder: false,
  missedDay: false,
  familyDigest: false,
  quietStart: "22:00",
  quietEnd: "08:00",
};

export function NotificationSetting() {
  const { t } = useTranslation();
  const { notificationEnabled, notificationTime, update } = useSettingsStore();
  const { show } = useToast();

  // Push / server-side notification settings.
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSubscriptionId, setPushSubscriptionId] = useState<string>("");
  const [remoteSettings, setRemoteSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [loadedRemote, setLoadedRemote] = useState(false);
  const [quietEnabled, setQuietEnabled] = useState(false);

  // Fetch remote settings once on mount (best-effort; ignore errors gracefully).
  useEffect(() => {
    let cancelled = false;
    getNotificationSettings()
      .then((s) => {
        if (cancelled) return;
        setRemoteSettings(s);
        setQuietEnabled(s.quietStart !== "" && s.quietStart !== "00:00");
        setLoadedRemote(true);
      })
      .catch(() => {
        // Not signed in or backend unavailable — silently skip.
        setLoadedRemote(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Local daily-reminder toggle (existing behaviour) ────────────────────────

  async function handleLocalToggle() {
    if (!notificationEnabled) {
      if (typeof Notification !== "undefined") {
        let permission = Notification.permission;
        if (permission === "default") {
          permission = await Notification.requestPermission();
        }
        if (permission === "denied") {
          show(t("settings.notification.push.permissionDenied"), "error");
          return;
        }
      }
      try {
        await update("notificationEnabled", true);
      } catch {
        show(t("settings.notification.push.saveError"), "error");
      }
    } else {
      try {
        await update("notificationEnabled", false);
      } catch {
        show(t("settings.notification.push.saveError"), "error");
      }
    }
  }

  async function handleLocalTimeChange(time: string) {
    try {
      await update("notificationTime", time);
    } catch {
      show(t("settings.notification.push.saveError"), "error");
    }
  }

  // ── Push subscribe toggle ────────────────────────────────────────────────────

  async function handlePushToggle() {
    if (pushEnabled) {
      setPushEnabled(false);
      if (pushSubscriptionId) {
        try {
          await disablePush(pushSubscriptionId);
        } catch (err) {
          console.warn("handlePushToggle: disablePush failed", err);
        }
        setPushSubscriptionId("");
      }
      return;
    }
    try {
      const keys = await ensurePushSubscription();
      if (!keys) {
        show(t("settings.notification.push.permissionDenied"), "error");
        return;
      }
      setPushSubscriptionId(keys.id);
      setPushEnabled(true);
    } catch {
      show(t("settings.notification.push.subscribeError"), "error");
    }
  }

  // ── Remote settings patch helper ─────────────────────────────────────────────

  async function patchRemote(patch: Partial<NotificationSettings>) {
    try {
      const updated = await patchNotificationSettings(patch);
      setRemoteSettings(updated);
    } catch {
      show(t("settings.notification.push.saveError"), "error");
    }
  }

  async function handleDailyReminderToggle(val: boolean) {
    setRemoteSettings((s) => ({ ...s, dailyReminder: val }));
    await patchRemote({ dailyReminder: val });
  }

  async function handleMissedDayToggle(val: boolean) {
    setRemoteSettings((s) => ({ ...s, missedDay: val }));
    await patchRemote({ missedDay: val });
  }

  async function handleFamilyDigestToggle(val: boolean) {
    setRemoteSettings((s) => ({ ...s, familyDigest: val }));
    await patchRemote({ familyDigest: val });
  }

  async function handleReminderTimeChange(time: string) {
    setRemoteSettings((s) => ({ ...s, reminderTime: time }));
    await patchRemote({ reminderTime: time });
  }

  async function handleQuietToggle(val: boolean) {
    setQuietEnabled(val);
    if (!val) {
      setRemoteSettings((s) => ({ ...s, quietStart: "", quietEnd: "" }));
      await patchRemote({ quietStart: "", quietEnd: "" });
    } else {
      const start = "22:00";
      const end = "08:00";
      setRemoteSettings((s) => ({ ...s, quietStart: start, quietEnd: end }));
      await patchRemote({ quietStart: start, quietEnd: end });
    }
  }

  async function handleQuietStartChange(time: string) {
    setRemoteSettings((s) => ({ ...s, quietStart: time }));
    await patchRemote({ quietStart: time });
  }

  async function handleQuietEndChange(time: string) {
    setRemoteSettings((s) => ({ ...s, quietEnd: time }));
    await patchRemote({ quietEnd: time });
  }

  return (
    <div>
      {/* ── Local daily reminder (existing behaviour) ── */}
      <ToggleRow
        label={t("settings.notification.label")}
        checked={notificationEnabled}
        onChange={handleLocalToggle}
      />

      {notificationEnabled && (
        <>
          <TimeRow
            label={t("settings.notification.time")}
            value={notificationTime}
            onChange={handleLocalTimeChange}
          />
          <div
            style={{
              padding: "var(--space-3) var(--space-4)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 400,
                fontSize: "var(--text-caption)",
                color: "var(--color-text-muted)",
                lineHeight: 1.4,
              }}
            >
              {t("settings.notification.caveat")}
            </span>
          </div>
        </>
      )}

      {/* ── Push notifications (server-side) ── */}
      {loadedRemote && (
        <>
          <ToggleRow
            label={t("settings.notification.push.enableToggle")}
            checked={pushEnabled}
            onChange={handlePushToggle}
          />

          {pushEnabled && (
            <>
              <ToggleRow
                label={t("settings.notification.push.dailyReminder")}
                checked={remoteSettings.dailyReminder}
                onChange={handleDailyReminderToggle}
              />

              {remoteSettings.dailyReminder && (
                <TimeRow
                  label={t("settings.notification.time")}
                  value={remoteSettings.reminderTime}
                  onChange={handleReminderTimeChange}
                />
              )}

              <ToggleRow
                label={t("settings.notification.push.missedDay")}
                checked={remoteSettings.missedDay}
                onChange={handleMissedDayToggle}
              />

              <ToggleRow
                label={t("settings.notification.push.familyDigest")}
                checked={remoteSettings.familyDigest}
                onChange={handleFamilyDigestToggle}
              />

              {/* Quiet hours */}
              <ToggleRow
                label={t("settings.notification.push.quietHours")}
                checked={quietEnabled}
                onChange={handleQuietToggle}
              />

              {quietEnabled && (
                <>
                  <TimeRow
                    label={t("settings.notification.push.quietStart")}
                    value={remoteSettings.quietStart || "22:00"}
                    onChange={handleQuietStartChange}
                  />
                  <TimeRow
                    label={t("settings.notification.push.quietEnd")}
                    value={remoteSettings.quietEnd || "08:00"}
                    onChange={handleQuietEndChange}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
