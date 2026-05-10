import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settings-store";
import { useToast } from "@/components/shared/Toast";

export function HapticFeedbackSetting() {
  const { t } = useTranslation();
  const hapticFeedbackEnabled = useSettingsStore((s) => s.hapticFeedbackEnabled);
  const update = useSettingsStore((s) => s.update);
  const { show } = useToast();

  async function handleToggle() {
    const next = !hapticFeedbackEnabled;
    try {
      await update("hapticFeedbackEnabled", next);
      if (next && "vibrate" in navigator) {
        navigator.vibrate(10);
      }
    } catch {
      show("Failed to save setting", "error");
    }
  }

  return (
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
        {t("settings.hapticFeedback.label")}
      </span>
      <button
        role="switch"
        aria-checked={hapticFeedbackEnabled}
        onClick={handleToggle}
        style={{
          width: "48px",
          height: "26px",
          borderRadius: "13px",
          background: hapticFeedbackEnabled ? "var(--color-primary)" : "var(--color-border)",
          border: "none",
          cursor: "pointer",
          transition: "background 150ms ease-out",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: hapticFeedbackEnabled ? "24px" : "3px",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "var(--color-bg)",
            transition: "left 150ms ease-out",
          }}
        />
      </button>
    </div>
  );
}
