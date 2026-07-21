import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dexie from "dexie";
import { listBackups, restoreFromBackup, importFromFile } from "../../services/backup.service";
import { DB_NAME } from "../../db/database";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toast";

export function IntegrityErrorScreen() {
  const { t } = useTranslation();
  const { show } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileConfirmOpen, setFileConfirmOpen] = useState(false);
  // Last-resort escape hatch: shown once a restore attempt (from backup or
  // file) has failed, in case the database itself won't open at all.
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [deleteDbConfirmOpen, setDeleteDbConfirmOpen] = useState(false);

  async function handleRestoreFromBackup() {
    setIsLoading(true);
    try {
      const backups = await listBackups();
      if (backups.length === 0) {
        show(t("settings.backup.noBackup"), "error");
        setRestoreFailed(true);
        return;
      }
      await restoreFromBackup(backups[0].id!);
      window.location.reload();
    } catch (err) {
      console.error("[IntegrityErrorScreen] restoreFromBackup failed:", err);
      show(err instanceof Error ? err.message : t("errors.restoreFailed"), "error");
      setRestoreFailed(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteDatabaseConfirm() {
    setDeleteDbConfirmOpen(false);
    setIsLoading(true);
    try {
      await Dexie.delete(DB_NAME);
      window.location.reload();
    } catch (err) {
      console.error("[IntegrityErrorScreen] delete database failed:", err);
      show(err instanceof Error ? err.message : t("errors.deleteDatabaseFailed"), "error");
      setIsLoading(false);
    }
  }

  function handleRestoreFromFileClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected if needed
    e.target.value = "";
    setPendingFile(file);
    setFileConfirmOpen(true);
  }

  async function handleFileConfirm() {
    setFileConfirmOpen(false);
    if (!pendingFile) return;
    setIsLoading(true);
    try {
      await importFromFile(pendingFile);
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      show(message || t("errors.invalidFile"), "error");
      setRestoreFailed(true);
    } finally {
      setIsLoading(false);
      setPendingFile(null);
    }
  }

  function handleFileCancel() {
    setFileConfirmOpen(false);
    setPendingFile(null);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-dialog)" as React.CSSProperties["zIndex"],
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        {/* Error indicator */}
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "var(--color-expense-dim)",
            border: "1px solid var(--color-expense)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "center",
            boxShadow: "0 0 16px var(--color-expense)",
          }}
        >
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: "var(--text-subheading)",
              color: "var(--color-expense)",
            }}
          >
            !
          </span>
        </div>

        {/* Heading */}
        <h1
          style={{
            margin: 0,
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            textAlign: "center",
          }}
        >
          {t("errors.integrityTitle")}
        </h1>

        {/* Body text */}
        <p
          style={{
            margin: 0,
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 400,
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {t("errors.integrityBody")}
        </p>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {/* Restore from backup */}
          <button
            onClick={handleRestoreFromBackup}
            disabled={isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "52px",
              width: "100%",
              padding: "0 var(--space-4)",
              background: "var(--color-primary-dim)",
              border: "1px solid var(--color-primary)",
              borderRadius: "var(--space-2)",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.5 : 1,
              color: "var(--color-primary)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
            }}
          >
            {t("settings.backup.restore")}
          </button>

          {/* Restore from file */}
          <button
            onClick={handleRestoreFromFileClick}
            disabled={isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "52px",
              width: "100%",
              padding: "0 var(--space-4)",
              background: "none",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--space-2)",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.5 : 1,
              color: "var(--color-text)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
            }}
          >
            {t("settings.backup.restoreFile")}
          </button>

          {/* Last-resort destructive action — only shown once a restore attempt has failed */}
          {restoreFailed && (
            <button
              onClick={() => setDeleteDbConfirmOpen(true)}
              disabled={isLoading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "52px",
                width: "100%",
                padding: "0 var(--space-4)",
                background: "var(--color-expense-dim)",
                border: "1px solid oklch(62% 0.28 18 / 50%)",
                borderRadius: "var(--space-2)",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.5 : 1,
                color: "var(--color-expense)",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
              }}
            >
              {t("errors.deleteDatabase")}
            </button>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Confirm dialog for file restore */}
      <ConfirmDialog
        isOpen={fileConfirmOpen}
        title={t("settings.backup.restoreFile")}
        body={t("settings.backup.restoreFileConfirm")}
        confirmLabel={t("common.restore")}
        onConfirm={handleFileConfirm}
        onCancel={handleFileCancel}
        variant="destructive"
      />

      {/* Confirm dialog for last-resort database deletion */}
      <ConfirmDialog
        isOpen={deleteDbConfirmOpen}
        title={t("errors.deleteDatabase")}
        body={t("errors.deleteDatabaseConfirm")}
        confirmLabel={t("errors.deleteDatabase")}
        onConfirm={() => void handleDeleteDatabaseConfirm()}
        onCancel={() => setDeleteDbConfirmOpen(false)}
        confirmDisabled={isLoading}
        variant="destructive"
      />
    </div>
  );
}
