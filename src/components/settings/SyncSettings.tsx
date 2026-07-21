// Settings → Sync section — shows Periodic Background Sync support status,
// registration state, and last successful sync time.
// Phase 12 (architecture §1.1, §9.3).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSyncStore } from "@/stores/sync-store";
import { isPeriodicsyncSupported, isCatchUpSyncRegistered } from "@/services/sync/background-sync";
import { retryTerminalUploads } from "@/services/sync/engine";
import { useAuthStore } from "@/services/auth/session";

export function SyncSettings() {
  const { t } = useTranslation();
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastError = useSyncStore((s) => s.lastError);

  const [pbsSupported, setPbsSupported] = useState<boolean | null>(null);
  const [pbsRegistered, setPbsRegistered] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function handleRetryTerminal() {
    setRetrying(true);
    try {
      await retryTerminalUploads();
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    if (!isSignedIn) return;
    isPeriodicsyncSupported()
      .then(setPbsSupported)
      .catch(() => setPbsSupported(false));
    isCatchUpSyncRegistered()
      .then(setPbsRegistered)
      .catch(() => setPbsRegistered(false));
  }, [isSignedIn]);

  if (!isSignedIn) return null;

  function formatSyncTime(iso: string | null): string {
    if (!iso) return t("sync.never");
    const d = new Date(iso);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  }

  const pbsSupportLabel =
    pbsSupported === null
      ? t("sync.checking")
      : pbsSupported
        ? t("sync.supported")
        : t("sync.notAvailable");

  const pbsRegisteredLabel =
    pbsSupported === false
      ? "—"
      : pbsRegistered === null
        ? t("sync.checking")
        : pbsRegistered
          ? t("sync.active")
          : t("sync.inactive");

  return (
    <div>
      {/* B8 — quota-exceeded banner: shown when the engine marked uploads
          terminal after a 413 response. Stays until lastError changes. */}
      {lastError === "quota-exceeded" && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--color-expense-dim, oklch(62% 0.28 18 / 12%))",
            borderBottom: "1px solid var(--color-expense)",
            color: "var(--color-expense)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            lineHeight: 1.4,
          }}
        >
          <span>{t("sync.quotaBanner")}</span>
          <button
            onClick={handleRetryTerminal}
            disabled={retrying}
            style={{
              flexShrink: 0,
              minHeight: "32px",
              minWidth: "44px",
              padding: "0 var(--space-3)",
              background: "none",
              border: "1px solid var(--color-expense)",
              borderRadius: "var(--radius-btn)",
              color: "var(--color-expense)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-caption)",
              cursor: retrying ? "not-allowed" : "pointer",
              opacity: retrying ? 0.5 : 1,
            }}
          >
            {retrying ? t("sync.retrying") : t("sync.retry")}
          </button>
        </div>
      )}

      {/* Last sync */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          padding: "0 var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
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
          {t("sync.lastSync")}
        </span>
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "var(--text-caption)",
            color: isSyncing ? "var(--color-primary)" : "var(--color-text-secondary)",
          }}
        >
          {isSyncing ? t("sync.syncing") : formatSyncTime(lastSyncAt)}
        </span>
      </div>

      {/* Background sync support */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          padding: "0 var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
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
          {t("sync.backgroundSync")}
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: pbsSupported === true ? "var(--color-income)" : "var(--color-text-secondary)",
          }}
        >
          {pbsSupportLabel}
        </span>
      </div>

      {/* Registration status — only shown when PBS is supported */}
      {pbsSupported !== false && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: "52px",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--color-border)",
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
            {t("sync.fourHourSync")}
          </span>
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: pbsRegistered === true ? "var(--color-income)" : "var(--color-text-secondary)",
            }}
          >
            {pbsRegisteredLabel}
          </span>
        </div>
      )}
    </div>
  );
}
