// Admin → Audit log section (Phase 10e).
//
// Paginated audit log. Each row shows actor, action, target, and time.
// Uses opaque cursor returned by the backend for pagination.

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/components/shared/Toast";
import { listAuditLog, type AuditLogEntry } from "@/services/admin/client";

// ── Action formatting ──────────────────────────────────────────────────────────

const ACTION_LABEL_KEYS: Record<string, string> = {
  "user.suspend": "admin.audit.actions.userSuspend",
  "user.unsuspend": "admin.audit.actions.userUnsuspend",
  "admin.promote": "admin.audit.actions.adminPromote",
  "admin.demote": "admin.audit.actions.adminDemote",
  "allowlist.add": "admin.audit.actions.allowlistAdd",
  "allowlist.remove": "admin.audit.actions.allowlistRemove",
  "device.revoke.admin": "admin.audit.actions.deviceRevokeAdmin",
  "user.delete": "admin.audit.actions.userDelete",
};

function formatAction(action: string, t: (key: string) => string): string {
  const key = ACTION_LABEL_KEYS[action];
  return key ? t(key) : action.replace(/_/g, " ");
}

function formatDetailJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function actionColor(action: string): string {
  if (
    action === "user.suspend" ||
    action === "user.delete" ||
    action === "admin.demote" ||
    action === "allowlist.remove" ||
    action === "device.revoke.admin"
  ) {
    return "var(--color-expense)";
  }
  if (action === "admin.promote" || action === "allowlist.add" || action === "user.unsuspend") {
    return "var(--color-income)";
  }
  return "var(--color-text-secondary)";
}

// ── AuditRow ───────────────────────────────────────────────────────────────────

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation();
  const d = new Date(entry.createdAt);
  const dateStr = d.toLocaleDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "var(--space-3) var(--space-4)",
        borderBottom: "1px solid var(--color-border)",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        {/* Action */}
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
            color: actionColor(entry.action),
          }}
        >
          {formatAction(entry.action, t)}
        </span>

        {/* Actor */}
        {entry.actorEmail && (
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
            }}
          >
            {t("admin.audit.by", { email: entry.actorEmail })}
          </span>
        )}

        {/* Target */}
        {entry.targetKind && entry.targetId && (
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
            }}
          >
            {entry.targetKind}: {entry.targetId}
          </span>
        )}

        {/* Detail JSON (B8) — render as a compact monospace block when set. */}
        {entry.detailJson && (
          <pre
            style={{
              margin: "var(--space-1) 0 0 0",
              padding: "var(--space-2)",
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "11px",
              color: "var(--color-text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {formatDetailJson(entry.detailJson)}
          </pre>
        )}
      </div>

      {/* Timestamp */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 2,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
          }}
        >
          {timeStr}
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
          }}
        >
          {dateStr}
        </span>
      </div>
    </div>
  );
}

// ── AuditViewer ────────────────────────────────────────────────────────────────

export function AuditViewer() {
  const { t } = useTranslation();
  const { show: showToast } = useToast();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listAuditLog();
      setEntries(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.audit.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listAuditLog(nextCursor);
      setEntries((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.loadMoreFailed"), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        {t("common.loading")}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        {t("admin.audit.empty")}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-secondary)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {t("admin.audit.countLabel", { count: entries.length })}
      </div>

      {entries.map((entry) => (
        <AuditRow key={entry.id} entry={entry} />
      ))}

      {nextCursor && (
        <div
          style={{
            padding: "var(--space-4)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              minHeight: "44px",
              padding: "0 var(--space-6)",
              background: "var(--color-surface-raised)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              cursor: loadingMore ? "not-allowed" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? t("common.loading") : t("admin.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
