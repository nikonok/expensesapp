import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine } from "lucide-react";
import type { CSSProperties } from "react";
import { useUIStore } from "@/stores/ui-store";
import { triggerInstall } from "@/sw-register";

export function InstallPopup() {
  const showInstallPrompt = useUIStore((s) => s.showInstallPrompt);
  const setShowInstallPrompt = useUIStore((s) => s.setShowInstallPrompt);
  const [countdown, setCountdown] = useState(5);
  const [installing, setInstalling] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (showInstallPrompt) setCountdown(5);
  }, [showInstallPrompt]);

  useEffect(() => {
    if (!showInstallPrompt) return;
    if (countdown <= 0) {
      setShowInstallPrompt(false);
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [showInstallPrompt, countdown, setShowInstallPrompt]);

  if (!showInstallPrompt) return null;

  return (
    <>
      <style>{`
        @keyframes install-popup-fade {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-popup-title"
        style={
          {
            position: "fixed",
            inset: 0,
            background: "oklch(8% 0.02 265 / 60%)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 350,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-4)",
          } as CSSProperties
        }
      >
        <div
          style={{
            width: "100%",
            maxWidth: 360,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
            padding: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-4)",
            animation: "install-popup-fade 150ms ease-out",
          }}
        >
          <ArrowDownToLine size={32} style={{ color: "var(--color-primary)" }} />
          <div
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <h2
              id="install-popup-title"
              style={{
                fontFamily: "Syne, sans-serif",
                fontSize: "var(--text-subheading)",
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              {t("onboarding.install.title")}
            </h2>
            <p
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              {t("onboarding.install.subtitle")}
            </p>
          </div>
          {countdown > 0 && (
            <p
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              {t("onboarding.install.countdown", { seconds: countdown })}
            </p>
          )}
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <button
              disabled={installing}
              onClick={async () => {
                setInstalling(true);
                try {
                  await triggerInstall();
                } finally {
                  setShowInstallPrompt(false);
                }
              }}
              style={{
                width: "100%",
                minHeight: 44,
                background: "var(--color-primary)",
                color: "var(--color-bg)",
                border: "none",
                borderRadius: "var(--radius-btn)",
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-body)",
                fontWeight: 500,
                cursor: installing ? "not-allowed" : "pointer",
                opacity: installing ? 0.6 : 1,
              }}
            >
              {t("onboarding.install.cta")}
            </button>
            <button
              onClick={() => {
                setShowInstallPrompt(false);
              }}
              style={{
                width: "100%",
                minHeight: 44,
                background: "transparent",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-btn)",
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-body)",
                cursor: "pointer",
              }}
            >
              {t("onboarding.install.skip")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
