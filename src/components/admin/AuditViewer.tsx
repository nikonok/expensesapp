// Admin → Audit log section (Phase 10e).
//
// Paginated audit log. Each row shows actor, action, target, and time.
// Uses opaque cursor returned by the backend for pagination.

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/shared/Toast";
import { listAuditLog, type AuditLogEntry } from "@/services/admin/client";

// ── Action formatting ──────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  suspend_user: "Suspended user",
  unsuspend_user: "Unsuspended user",
  promote_admin: "Promoted to admin",
  demote_admin: "Demoted from admin",
  add_allowlist: "Added to allowlist",
  remove_allowlist: "Removed from allowlist",
  revoke_device: "Revoked device",
  delete_user: "Deleted user",
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function actionColor(action: string): string {
  if (
    action.includes("suspend") ||
    action.includes("delete") ||
    action.includes("demote") ||
    action.includes("remove")
  ) {
    return "var(--color-expense)";
  }
  if (action.includes("promote") || action.includes("add") || action.includes("unsuspend")) {
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
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
          }}
        >
          by {entry.actorEmail}
        </span>

        {/* Target */}
        {entry.targetEmail && (
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
            }}
          >
            target: {entry.targetEmail}
          </span>
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
      setEntries(page.entries);
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
      setEntries((prev) => [...prev, ...page.entries]);
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
