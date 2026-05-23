import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { listSnapshots, restoreSnapshot, type SnapshotEntry } from "@/services/snapshots/client";
import { pullSince } from "@/services/sync/engine";
import { getLocalFamilyId } from "@/services/family/active-family";
import { setCursor } from "@/services/sync/cursor";
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
      console.error("[SnapshotRestore] listSnapshots failed:", err);
      show(err instanceof Error ? err.message : t("errors.generic"), "error");
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
      const familyId = await getLocalFamilyId();
      if (familyId) {
        // Replace the local cursor with the one returned by the snapshot restore,
        // then trigger a full pull from scratch (cursor=undefined) so the local
        // DB is rebuilt from the restored state.
        await setCursor(familyId, newCursor);
        await pullSince(familyId, undefined);
      }
      show(t("settings.backup.snapshotRestored"), "success");
    } catch (err) {
      console.error("[SnapshotRestore] restore failed:", err);
      show(err instanceof Error ? err.message : t("errors.generic"), "error");
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
                  Restore
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
        confirmLabel="Restore"
        onConfirm={handleRestoreConfirm}
        onCancel={() => setConfirmDate(null)}
        variant="destructive"
      />
    </div>
  );
}
