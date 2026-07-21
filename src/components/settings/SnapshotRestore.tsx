import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { db } from "@/db/database";
import { listSnapshots, restoreSnapshot, type SnapshotEntry } from "@/services/snapshots/client";
import { pullSince } from "@/services/sync/engine";
import { getLocalFamilyId } from "@/services/family/active-family";
import { logger } from "@/services/log.service";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { useToast } from "../shared/Toast";

export function SnapshotRestore() {
  const { t } = useTranslation();
  const { show } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[] | null>(null);
  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  async function handleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setLoading(true);
    setExpanded(true);
    try {
      const list = await listSnapshots();
      setSnapshots(list);
    } catch (err) {
      logger.warn(
        "snapshotRestore.list.failed",
        err instanceof Error ? err : new Error(String(err)),
      );
      show(t("settings.backup.snapshotListFailed"), "error");
      setExpanded(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestoreConfirm() {
    if (!confirmDate) return;
    const date = confirmDate;
    setConfirmDate(null);
    setRestoring(true);
    try {
      const { newCursor } = await restoreSnapshot(date, true);
      logger.info("snapshotRestore.restore.newCursor", { newCursor });
      const familyId = await getLocalFamilyId();
      if (familyId) {
        // Stale outbox rows point at parentVersions that mean nothing once
        // the server state has been wholesale replaced by the snapshot —
        // pushing them would just churn/conflict forever.
        await db.pendingUploads.clear();
        // Full pull from scratch (cursor omitted) rebuilds the local DB to
        // match the restored server state, with pullSince's own bookkeeping
        // advancing the cursor record-by-record as each one is applied. Do
        // NOT pre-adopt `newCursor` here: if this pull throws before
        // applying anything (e.g. the very first network request fails), a
        // pre-set cursor would be left sitting AT the final post-restore
        // position with zero records actually applied locally — a later
        // retry would then pull `since=newCursor` and get nothing,
        // permanently orphaning the rebuild.
        await pullSince(familyId, undefined);
      }
      show(t("settings.backup.snapshotRestored"), "success");
    } catch (err) {
      logger.warn(
        "snapshotRestore.restore.failed",
        err instanceof Error ? err : new Error(String(err)),
      );
      show(t("errors.restoreFailed"), "error");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div>
      {/* Expand / collapse toggle */}
      <button
        onClick={handleExpand}
        disabled={restoring}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          width: "100%",
          padding: "0 var(--space-4)",
          background: "none",
          border: "none",
          borderBottom: expanded ? "none" : "1px solid var(--color-border)",
          cursor: restoring ? "not-allowed" : "pointer",
          color: "var(--color-text)",
          opacity: restoring ? 0.5 : 1,
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
          }}
        >
          {t("settings.backup.snapshotRestore")}
        </span>
        {expanded ? (
          <ChevronUp size={16} strokeWidth={2} style={{ color: "var(--color-text-secondary)" }} />
        ) : (
          <ChevronDown size={16} strokeWidth={2} style={{ color: "var(--color-text-secondary)" }} />
        )}
      </button>

      {/* Snapshot list */}
      {expanded && (
        <div
          style={{
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {loading && (
            <div
              style={{
                padding: "var(--space-4)",
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
                textAlign: "center",
              }}
            >
              Loading…
            </div>
          )}

          {!loading && snapshots !== null && snapshots.length === 0 && (
            <div
              style={{
                padding: "var(--space-4)",
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
                textAlign: "center",
              }}
            >
              {t("settings.backup.snapshotNoSnapshots")}
            </div>
          )}

          {!loading &&
            snapshots !== null &&
            snapshots.map((snap) => (
              <div
                key={snap.snapshotId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: "48px",
                  padding: "0 var(--space-4) 0 var(--space-6)",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontWeight: 500,
                    fontSize: "var(--text-caption)",
                    color: "var(--color-text)",
                  }}
                >
                  {snap.date}
                </span>
                <button
                  onClick={() => setConfirmDate(snap.date)}
                  disabled={restoring}
                  style={{
                    minHeight: "32px",
                    padding: "0 var(--space-3)",
                    background: "var(--color-expense-dim)",
                    color: "var(--color-expense)",
                    border: "1px solid oklch(62% 0.28 18 / 50%)",
                    borderRadius: "var(--radius-btn)",
                    fontFamily: '"DM Sans", sans-serif',
                    fontWeight: 500,
                    fontSize: "var(--text-caption)",
                    cursor: restoring ? "not-allowed" : "pointer",
                    opacity: restoring ? 0.5 : 1,
                  }}
                >
                  {t("common.restore")}
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmDate !== null}
        title={t("settings.backup.snapshotRestore")}
        body={t("settings.backup.snapshotRestoreConfirm", { date: confirmDate ?? "" })}
        confirmLabel={t("common.restore")}
        onConfirm={handleRestoreConfirm}
        onCancel={() => setConfirmDate(null)}
        variant="destructive"
      />
    </div>
  );
}
