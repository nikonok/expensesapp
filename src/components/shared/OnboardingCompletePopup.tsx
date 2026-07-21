import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MouseEvent } from "react";
import { Sparkles, X as XIcon } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { DEFAULTS, useSettingsStore } from "@/stores/settings-store";
import { db } from "@/db/database";

export function OnboardingCompletePopup() {
  const show = useUIStore((s) => s.showOnboardingCompletePopup);
  const setShow = useUIStore((s) => s.setShowOnboardingCompletePopup);
  const [cancelling, setCancelling] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!show) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShow(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [show, setShow]);

  if (!show) return null;

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setShow(false);
  };

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
      // Reset from the store's single DEFAULTS source so no key is missed
      // (previously this hand-rolled a subset and silently kept stale state
      // for any key added to DEFAULTS afterward — e.g. hapticFeedbackEnabled,
      // pushSubscriptionId).
      useSettingsStore.setState({ ...DEFAULTS });
    } catch (err) {
      console.error("Onboarding cancel failed:", err);
      setCancelling(false);
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
        onClick={handleBackdropClick}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklch, var(--color-bg) 60%, transparent)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          zIndex: "var(--z-dialog)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-4)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 360,
            background: "var(--color-surface)",
            border: "1px solid var(--color-primary-dim)",
            borderRadius: "var(--radius-card)",
            padding: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-4)",
            animation: "onboarding-complete-fade 150ms ease-out",
          }}
        >
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setShow(false)}
            style={{
              position: "absolute",
              top: "var(--space-2)",
              right: "var(--space-2)",
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-secondary)",
              borderRadius: "var(--radius-btn)",
              padding: 0,
            }}
          >
            <XIcon size={20} strokeWidth={1.5} />
          </button>

          <Sparkles
            size={32}
            strokeWidth={1.5}
            style={{
              color: "var(--color-primary)",
              filter: "drop-shadow(0 0 12px oklch(72% 0.22 210 / 50%))",
            }}
          />

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
                textShadow: "0 0 12px oklch(72% 0.22 210 / 30%)",
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

          <button
            type="button"
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
