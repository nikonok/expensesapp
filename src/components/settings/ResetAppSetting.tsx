import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { useToast } from "../shared/Toast";
import { resetApp } from "../../services/reset.service";
import { useTranslation } from "@/hooks/use-translation";

export function ResetAppSetting() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  async function handleConfirm() {
    if (isResetting) return;
    setIsResetting(true);
    try {
      await resetApp();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      show(
        message.toLowerCase().includes("quota") ? t("errors.quotaExceeded") : t("errors.generic"),
        "error",
      );
      setIsResetting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={isResetting}
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
          cursor: "pointer",
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
          {t("settings.reset.label")}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: "var(--color-expense)" }} />
      </button>
      <ConfirmDialog
        isOpen={confirmOpen}
        title={t("settings.reset.confirmTitle")}
        body={t("settings.reset.confirmBody")}
        confirmLabel={isResetting ? "..." : t("settings.reset.confirmAction")}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!isResetting) setConfirmOpen(false);
        }}
        confirmDisabled={isResetting}
        variant="destructive"
      />
    </>
  );
}
