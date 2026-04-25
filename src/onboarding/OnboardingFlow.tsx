import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { CurrencyPicker } from "../components/shared/CurrencyPicker";
import { Numpad } from "../components/shared/Numpad";
import { NumpadDisplay } from "../components/shared/NumpadDisplay";
import { getLucideIcon } from "../components/shared/IconPicker";
import { useSettingsStore } from "../stores/settings-store";
import { db } from "../db/database";
import { DEFAULT_CATEGORY_PRESETS } from "../db/seed";
import type { CategoryPreset } from "../db/seed";
import { evaluateExpression } from "../services/math-parser";
import { getCanInstall } from "../sw-register";
import { useUIStore } from "../stores/ui-store";

const TOTAL_STEPS = 4;

function detectLocaleCurrency(): string {
  try {
    const opts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    }).resolvedOptions();
    return (opts as { currency?: string }).currency ?? "USD";
  } catch {
    return "USD";
  }
}

// ── Progress dots ──────────────────────────────────────────────────────────────

function ProgressDots({ current, onBack }: { current: number; onBack?: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        paddingTop: "var(--space-4)",
        paddingInline: "var(--space-2)",
      }}
    >
      <div
        style={{
          minWidth: "44px",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              minWidth: "44px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-secondary)",
              padding: 0,
            }}
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", gap: "var(--space-2)", justifyContent: "center" }}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            style={{
              width: i === current ? "20px" : "8px",
              height: "8px",
              borderRadius: "4px",
              background: i === current ? "var(--color-primary)" : "var(--color-border-strong)",
              transition: "width 200ms ease-out, background 200ms ease-out",
            }}
          />
        ))}
      </div>
      <div style={{ minWidth: "44px" }} />
    </div>
  );
}

// ── Shared button styles ───────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  minHeight: "52px",
  width: "100%",
  background: "var(--color-primary)",
  color: "var(--color-bg)",
  border: "none",
  borderRadius: "var(--radius-btn)",
  fontFamily: '"Syne", sans-serif',
  fontWeight: 700,
  fontSize: "1rem",
  letterSpacing: "0.05em",
  cursor: "pointer",
  boxShadow: "0 4px 16px oklch(72% 0.22 210 / 30%)",
};

const skipLinkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-text-secondary)",
  fontFamily: '"DM Sans", sans-serif',
  fontSize: "var(--text-body)",
  cursor: "pointer",
  padding: "var(--space-3) var(--space-4)",
  minHeight: "44px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

// ── Step 1: Welcome ────────────────────────────────────────────────────────────

function StepWelcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        gap: "var(--space-4)",
        padding: "0 var(--space-6)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-3)",
          marginBottom: "var(--space-8)",
        }}
      >
        <h1
          style={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-display)",
            color: "var(--color-primary)",
            margin: 0,
            lineHeight: 1,
            textShadow: "0 0 40px oklch(72% 0.22 210 / 40%)",
          }}
        >
          {t("onboarding.welcome.title")}
        </h1>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-subheading)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          {t("onboarding.welcome.subtitle")}
        </p>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-disabled)",
            margin: 0,
            marginTop: "var(--space-2)",
          }}
        >
          {t("onboarding.welcome.storageNotice")}
        </p>
      </div>
      <div
        style={{ width: "100%", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
      >
        <button style={primaryBtnStyle} onClick={onNext}>
          {t("onboarding.welcome.cta")}
        </button>
        <button style={skipLinkStyle} onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Currency ───────────────────────────────────────────────────────────

function StepCurrency({
  currency,
  onChange,
  onNext,
  onSkip,
}: {
  currency: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 var(--space-4)" }}>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h2
          style={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            margin: "0 0 var(--space-2)",
          }}
        >
          {t("onboarding.currency.title")}
        </h2>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          {t("onboarding.currency.subtitle")}
        </p>
      </div>
      <div style={{ flex: 1 }}>
        <CurrencyPicker value={currency} onChange={onChange} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          paddingTop: "var(--space-4)",
        }}
      >
        <button style={primaryBtnStyle} onClick={onNext}>
          {t("common.next")}
        </button>
        <button style={skipLinkStyle} onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: First Account ──────────────────────────────────────────────────────

function StepAccount({
  accountName,
  onAccountNameChange,
  numpadValue,
  onNumpadChange,
  onNumpadSave,
  currencyCode,
  onNext,
  onSkip,
}: {
  accountName: string;
  onAccountNameChange: (v: string) => void;
  numpadValue: string;
  onNumpadChange: (v: string) => void;
  onNumpadSave: (result: number) => void;
  currencyCode: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 var(--space-4)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2
          style={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            margin: "0 0 var(--space-2)",
          }}
        >
          {t("onboarding.account.title")}
        </h2>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          {t("onboarding.account.subtitle")}
        </p>
      </div>
      <input
        type="text"
        value={accountName}
        onChange={(e) => onAccountNameChange(e.target.value.slice(0, 64))}
        placeholder={t("accounts.fields.name")}
        style={{
          minHeight: "44px",
          padding: "0 var(--space-3)",
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-input)",
          color: "var(--color-text)",
          fontSize: "var(--text-body)",
          fontFamily: '"DM Sans", sans-serif',
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          marginBottom: "var(--space-4)",
        }}
      />
      <NumpadDisplay
        value={numpadValue}
        isActive={true}
        align="center"
        color={numpadValue ? "var(--color-income)" : "var(--color-text-disabled)"}
        style={{ padding: "var(--space-3) 0", minHeight: "3rem" }}
      />
      <div style={{ flex: 1 }}>
        <Numpad
          value={numpadValue}
          onChange={onNumpadChange}
          onSave={onNumpadSave}
          variant="budget"
          currencyCode={currencyCode}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          paddingTop: "var(--space-2)",
        }}
      >
        <button style={primaryBtnStyle} onClick={onNext}>
          {t("common.next")}
        </button>
        <button style={skipLinkStyle} onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Category Presets ───────────────────────────────────────────────────

function StepCategories({
  selected,
  onToggle,
  onNext,
  onSkip,
}: {
  selected: boolean[];
  onToggle: (i: number) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 var(--space-4)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2
          style={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            margin: "0 0 var(--space-2)",
          }}
        >
          {t("onboarding.categories.title")}
        </h2>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          {t("onboarding.categories.subtitle")}
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-3)",
          flex: 1,
          overflowY: "auto",
        }}
      >
        {DEFAULT_CATEGORY_PRESETS.map((preset: CategoryPreset, i: number) => {
          const IconComp = getLucideIcon(preset.icon);
          return (
            <button
              key={preset.name}
              onClick={() => onToggle(i)}
              style={{
                minHeight: "72px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-2)",
                background: selected[i] ? "var(--color-primary-dim)" : "var(--color-surface)",
                border: `1px solid ${selected[i] ? "var(--color-primary)" : "var(--color-border)"}`,
                borderRadius: "var(--radius-card)",
                cursor: "pointer",
                transition: "background 150ms ease-out, border-color 150ms ease-out",
                padding: "var(--space-3)",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "var(--radius-icon)",
                  background: preset.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: selected[i] ? 1 : 0.5,
                  transition: "opacity 150ms ease-out",
                }}
              >
                {IconComp && <IconComp size={18} color="white" strokeWidth={1.5} />}
              </div>
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-caption)",
                  fontWeight: 500,
                  color: selected[i] ? "var(--color-text)" : "var(--color-text-secondary)",
                  textAlign: "center",
                }}
              >
                {preset.name}
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          paddingTop: "var(--space-4)",
        }}
      >
        <button style={primaryBtnStyle} onClick={onNext}>
          {t("common.next")}
        </button>
        <button style={skipLinkStyle} onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </div>
  );
}

// ── Slide container ────────────────────────────────────────────────────────────

function SlideContainer({
  step,
  direction,
  children,
}: {
  step: number;
  direction: "forward" | "back";
  children: React.ReactNode;
}) {
  return (
    <div
      key={step}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        animation: `${direction === "back" ? "onboarding-slide-back" : "onboarding-slide-in"} 250ms ease-out`,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

// ── Main flow ──────────────────────────────────────────────────────────────────

export default function OnboardingFlow() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const settingsStore = useSettingsStore();

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [currency, setCurrency] = useState<string>(() => detectLocaleCurrency());
  const [accountName, setAccountName] = useState("Cash");
  const [numpadValue, setNumpadValue] = useState("");
  const [startingBalance, setStartingBalance] = useState(0);
  const [categorySelected, setCategorySelected] = useState<boolean[]>(() =>
    DEFAULT_CATEGORY_PRESETS.map(() => true),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNumpadSave = (result: number) => {
    setStartingBalance(result);
    setNumpadValue(String(result / 100));
    goToStep(3);
  };

  const goToStep = (n: number) => {
    setDirection(n > step ? "forward" : "back");
    setStep(n);
  };
  const skipToComplete = () => {
    void handleFinish(true);
  };

  const handleToggleCategory = (i: number) => {
    setCategorySelected((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const handleFinish = async (skipAccount = false) => {
    setIsSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();

      // 1. Save main currency
      await settingsStore.update("mainCurrency", currency);

      // 2. Create first account if name was provided (skipped when user skips onboarding)
      if (!skipAccount && accountName.trim()) {
        await db.accounts.add({
          name: accountName.trim(),
          type: "REGULAR",
          color: "var(--color-primary)",
          icon: "wallet",
          currency: currency,
          description: "",
          balance: startingBalance,
          startingBalance: startingBalance,
          includeInTotal: true,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 3. Create selected category presets
      const selectedPresets = DEFAULT_CATEGORY_PRESETS.filter((_, i) => categorySelected[i]);
      if (selectedPresets.length > 0) {
        await db.categories.bulkAdd(
          selectedPresets.map((preset, idx) => ({
            name: preset.name,
            type: preset.type,
            color: preset.color,
            icon: preset.icon,
            displayOrder: idx,
            isTrashed: false,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      // 4. Mark onboarding complete
      await settingsStore.update("hasCompletedOnboarding", true);

      // 5. Navigate to startup screen
      navigate(`/${settingsStore.startupScreen}`, { replace: true });
      if (getCanInstall()) {
        useUIStore.getState().setShowInstallPrompt(true);
      }
      useUIStore.getState().setShowOnboardingCompletePopup(true);
    } catch (err) {
      console.error("Onboarding save failed:", err);
      setError(t("errors.generic"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes onboarding-slide-in {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes onboarding-slide-back {
          from { opacity: 0; transform: translateX(-32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div
        style={{
          minHeight: "100dvh",
          background: "var(--color-bg)",
          display: "flex",
          flexDirection: "column",
          maxWidth: "480px",
          margin: "0 auto",
          padding:
            "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
        }}
      >
        {step < TOTAL_STEPS && (
          <ProgressDots current={step} onBack={step > 0 ? () => goToStep(step - 1) : undefined} />
        )}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            paddingBottom: "var(--space-6)",
          }}
        >
          <SlideContainer step={step} direction={direction}>
            {step === 0 && <StepWelcome onNext={() => goToStep(1)} onSkip={skipToComplete} />}
            {step === 1 && (
              <StepCurrency
                currency={currency}
                onChange={setCurrency}
                onNext={() => goToStep(2)}
                onSkip={skipToComplete}
              />
            )}
            {step === 2 && (
              <StepAccount
                accountName={accountName}
                onAccountNameChange={setAccountName}
                numpadValue={numpadValue}
                onNumpadChange={setNumpadValue}
                onNumpadSave={handleNumpadSave}
                currencyCode={currency}
                onNext={() => {
                  const result = evaluateExpression(numpadValue);
                  if (result !== null) {
                    setStartingBalance(result);
                    setNumpadValue(String(result / 100));
                  } else {
                    setStartingBalance(0);
                    setNumpadValue("");
                  }
                  goToStep(3);
                }}
                onSkip={skipToComplete}
              />
            )}
            {step === 3 && (
              <StepCategories
                selected={categorySelected}
                onToggle={handleToggleCategory}
                onNext={() => {
                  void handleFinish();
                }}
                onSkip={skipToComplete}
              />
            )}
          </SlideContainer>
        </div>
      </div>
    </>
  );
}
