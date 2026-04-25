import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { db } from "@/db/database";

const COUNTDOWN_START = 6;

export function OnboardingCompletePopup() {
  const show = useUIStore((s) => s.showOnboardingCompletePopup);
  const setShow = useUIStore((s) => s.setShowOnboardingCompletePopup);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [cancelling, setCancelling] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (show) {
      setCountdown(COUNTDOWN_START);
      setCancelling(false);
    }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    if (countdown <= 0) {
      setShow(false);
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [show, countdown, setShow]);

  if (!show) return null;

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await db.transaction(
        "rw",
        [db.accounts, db.categories, db.transactions, db.budgets, db.settings],
        async () => {
          await db.accounts.clear();
          await db.categories.clear();
          await db.transactions.clear();
          await db.budgets.clear();
          await db.settings.clear();
        },
      );
      useSettingsStore.setState({
        mainCurrency: "USD",
        language: "en",
        startupScreen: "transactions",
        notificationEnabled: false,
        notificationTime: "20:00",
        lastUsedAccountId: null,
        autoBackupIntervalHours: null,
        lastAutoBackupAt: null,
        hasCompletedOnboarding: false,
        logLevel: "errors",
      });
    } catch (err) {
      console.error("Onboarding cancel failed:", err);
    } finally {
      setShow(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes onboarding-complete-fade {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-complete-title"
        aria-describedby="onboarding-complete-body"
        style={
          {
            position: "fixed",
            inset: 0,
            background: "oklch(8% 0.02 265 / 60%)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 360,
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
            animation: "onboarding-complete-fade 150ms ease-out",
          }}
        >
          <div
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <h2
              id="onboarding-complete-title"
              style={{
                fontFamily: "Syne, sans-serif",
                fontWeight: 700,
                fontSize: "var(--text-subheading)",
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              {t("onboarding.complete.title")}
            </h2>
            <p
              id="onboarding-complete-body"
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-body)",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              {t("onboarding.complete.body")}
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
              {t("onboarding.complete.countdown", { seconds: countdown })}
            </p>
          )}
          <button
            onClick={() => void handleCancel()}
            disabled={cancelling}
            style={{
              width: "100%",
              minHeight: 44,
              background: "var(--color-expense-dim)",
              color: "var(--color-expense)",
              border: "1px solid oklch(62% 0.28 18 / 50%)",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-body)",
              fontWeight: 500,
              cursor: cancelling ? "not-allowed" : "pointer",
              opacity: cancelling ? 0.6 : 1,
            }}
          >
            {t("onboarding.complete.cancel")}
          </button>
        </div>
      </div>
    </>
  );
}
