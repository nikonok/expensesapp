import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/services/auth/session";
import { requestDeletion, cancelDeletion } from "@/services/account/delete-client";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";

function daysUntil(isoString: string): number {
  const diff = new Date(isoString).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function AccountDeletion() {
  const { t } = useTranslation();
  const { show } = useToast();

  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.user);

  // Seed from /me response if the user already has a pending deletion
  const [deleteAfter, setDeleteAfter] = useState<string | null>(() => user?.deleteAfter ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  void setUser; // silence unused var — we only read user for initial state

  async function handleConfirmDelete() {
    setConfirmOpen(false);
    setCheckboxChecked(false);
    setIsLoading(true);
    try {
      const { deleteAfter: da } = await requestDeletion();
      setDeleteAfter(da);
    } catch {
      show(t("errors.generic"), "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCancel() {
    setIsLoading(true);
    try {
      await cancelDeletion();
      setDeleteAfter(null);
    } catch {
      show(t("errors.generic"), "error");
    } finally {
      setIsLoading(false);
    }
  }

  if (deleteAfter) {
    const days = daysUntil(deleteAfter);
    return (
      <div
        style={{
          padding: "var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            background: "var(--color-expense-dim)",
            border: "1px solid oklch(62% 0.28 18 / 30%)",
            borderRadius: "var(--radius-card)",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              color: "var(--color-expense)",
              margin: 0,
            }}
          >
            {t("settings.accountDeletion.countdown", { count: days })}
          </p>
          <button
            onClick={handleCancel}
            disabled={isLoading}
            style={{
              minHeight: "44px",
              padding: "0 var(--space-4)",
              background: "none",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              alignSelf: "flex-start",
            }}
          >
            {t("settings.accountDeletion.cancelDeletion")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={isLoading}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          width: "100%",
          padding: "0 var(--space-4)",
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          cursor: isLoading ? "not-allowed" : "pointer",
          opacity: isLoading ? 0.6 : 1,
          color: "var(--color-expense)",
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
          }}
        >
          {t("settings.accountDeletion.label")}
        </span>
      </button>

      {/* Custom confirm dialog with checkbox */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--z-dialog)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-4)",
          }}
        >
          <div
            aria-hidden="true"
            onClick={() => {
              setConfirmOpen(false);
              setCheckboxChecked(false);
            }}
            style={{
              position: "absolute",
              inset: 0,
              background: "oklch(0% 0 0 / 60%)",
            }}
          />
          <div
            style={{
              position: "relative",
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
              padding: "var(--space-6)",
              width: "100%",
              maxWidth: "320px",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <h2
              id="delete-account-dialog-title"
              style={{
                fontFamily: "Syne, sans-serif",
                fontWeight: 700,
                fontSize: "var(--text-heading)",
                color: "var(--color-expense)",
                margin: 0,
              }}
            >
              {t("settings.accountDeletion.confirmTitle")}
            </h2>
            <p
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-body)",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              {t("settings.accountDeletion.confirmBody")}
            </p>

            {/* Checkbox */}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--space-3)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checkboxChecked}
                onChange={(e) => setCheckboxChecked(e.target.checked)}
                style={{ marginTop: "2px", flexShrink: 0, width: "16px", height: "16px" }}
              />
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-caption)",
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                {t("settings.accountDeletion.checkboxLabel")}
              </span>
            </label>

            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  setCheckboxChecked(false);
                }}
                style={{
                  minHeight: "44px",
                  padding: "0 var(--space-4)",
                  background: "var(--color-surface-raised)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "var(--radius-btn)",
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: "var(--text-body)",
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={!checkboxChecked}
                style={{
                  minHeight: "44px",
                  padding: "0 var(--space-4)",
                  background: "var(--color-expense-dim)",
                  color: "var(--color-expense)",
                  border: "1px solid oklch(62% 0.28 18 / 50%)",
                  borderRadius: "var(--radius-btn)",
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: "var(--text-body)",
                  opacity: checkboxChecked ? 1 : 0.4,
                  cursor: checkboxChecked ? "pointer" : "not-allowed",
                }}
              >
                {t("settings.accountDeletion.confirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
