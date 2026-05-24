// Settings → Sync section — shows Periodic Background Sync support status,
// registration state, and last successful sync time.
// Phase 12 (architecture §1.1, §9.3).

import { useEffect, useState } from "react";
import { useSyncStore } from "@/stores/sync-store";
import { isPeriodicsyncSupported, isCatchUpSyncRegistered } from "@/services/sync/background-sync";
import { useAuthStore } from "@/services/auth/session";

export function SyncSettings() {
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const isSyncing = useSyncStore((s) => s.isSyncing);

  const [pbsSupported, setPbsSupported] = useState<boolean | null>(null);
  const [pbsRegistered, setPbsRegistered] = useState<boolean | null>(null);

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
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  }

  const pbsSupportLabel =
    pbsSupported === null ? "Checking…" : pbsSupported ? "Supported" : "Not supported (iOS)";

  const pbsRegisteredLabel =
    pbsSupported === false
      ? "—"
      : pbsRegistered === null
        ? "Checking…"
        : pbsRegistered
          ? "Active"
          : "Inactive";

  return (
    <div>
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
          Last sync
        </span>
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "var(--text-caption)",
            color: isSyncing ? "var(--color-primary)" : "var(--color-text-secondary)",
          }}
        >
          {isSyncing ? "Syncing…" : formatSyncTime(lastSyncAt)}
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
          Background sync
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
            4-hour sync
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
