import { useState } from "react";
import { useTranslation } from "react-i18next";
import { sendLogsToSupport } from "@/services/account/logs-client";
import { useToast } from "@/components/shared/Toast";

export function SupportLogs() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [isSending, setIsSending] = useState(false);

  async function handleSend() {
    if (isSending) return;
    setIsSending(true);
    try {
      await sendLogsToSupport();
      show(t("settings.supportLogs.sent"), "success");
    } catch {
      show(t("errors.generic"), "error");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div>
      <p
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-secondary)",
          margin: 0,
          padding: "var(--space-3) var(--space-4) 0",
        }}
      >
        {t("settings.supportLogs.consentText")}
      </p>
      <button
        onClick={handleSend}
        disabled={isSending}
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
          cursor: isSending ? "not-allowed" : "pointer",
          opacity: isSending ? 0.6 : 1,
          color: "var(--color-text)",
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
          }}
        >
          {isSending ? t("settings.supportLogs.sending") : t("settings.supportLogs.label")}
        </span>
      </button>
    </div>
  );
}
