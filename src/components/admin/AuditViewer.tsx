// Admin → Audit log section (Phase 10e).
//
// Paginated audit log. Each row shows actor, action, target, and time.
// Uses opaque cursor returned by the backend for pagination.

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/shared/Toast";
import { listAuditLog, type AuditLogEntry } from "@/services/admin/client";

// ── Action formatting ──────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  "user.suspend": "Suspended user",
  "user.unsuspend": "Unsuspended user",
  "admin.promote": "Promoted to admin",
  "admin.demote": "Demoted from admin",
  "allowlist.add": "Added to allowlist",
  "allowlist.remove": "Removed from allowlist",
  "device.revoke.admin": "Revoked device",
  "user.delete": "Deleted user",
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
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
          {formatAction(entry.action)}
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
            by {entry.actorEmail}
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
      showToast(err instanceof Error ? err.message : "Failed to load audit log", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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
      showToast(err instanceof Error ? err.message : "Failed to load more", "error");
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
        Loading…
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
        No audit events yet.
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
        {entries.length} event{entries.length !== 1 ? "s" : ""} loaded
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
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
