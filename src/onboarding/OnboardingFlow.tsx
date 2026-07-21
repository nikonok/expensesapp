import { useState, useEffect, useRef } from "react";
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
import { getCurrencyDecimalPlaces } from "../utils/currency-utils";
import { getCanInstall } from "../sw-register";
import { useUIStore } from "../stores/ui-store";
import { SignInStep } from "./SignInStep";
import { RecoveryCodeSetup } from "../components/onboarding/RecoveryCodeSetup";
import { useAuthStore } from "../services/auth/session";
import { initFamilyAndShowPhrase } from "../services/family/init";
import { pushSetting } from "../services/sync/push-helpers";
import { logger } from "../services/log.service";
import { PRIMARY_ACCENT_COLOR } from "../utils/constants";

// Step order: 0=Sign-in, 1=RecoveryCode(conditional), 2=Welcome, 3=Currency, 4=First-account, 5=Categories
const TOTAL_STEPS = 6;

/** Named entry points for OnboardingFlow. Maps to a step index. */
export type OnboardingInitialStep = "sign-in" | "welcome";

function initialStepIndex(initial?: OnboardingInitialStep): number {
  switch (initial) {
    case "sign-in":
      return 0;
    case "welcome":
      return 2;
    default:
      return 0;
  }
}

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

// ── Step 2: Welcome ────────────────────────────────────────────────────────────

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

// ── Step 3: Currency ───────────────────────────────────────────────────────────

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

// ── Step 4: First Account ──────────────────────────────────────────────────────

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

// ── Step 5: Category Presets ───────────────────────────────────────────────────

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

// ── Step 1: Recovery Code ──────────────────────────────────────────────────────

function StepRecoveryCode({
  onNext,
  phrase,
  onPhraseReady,
}: {
  onNext: () => void;
  /** Phrase generated earlier this onboarding session, if any — lifted to the
   *  parent so a remount (e.g. forward-navigating back into this step) can
   *  re-show it instead of re-running family init. */
  phrase: string | null;
  onPhraseReady: (phrase: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!phrase);
  const authStore = useAuthStore();
  // Guards against React StrictMode's dev-only double-invoke of this effect
  // (mount → cleanup → mount again on the same instance), which would
  // otherwise fire two concurrent `initFamilyAndShowPhrase` calls.
  const hasStartedRef = useRef(false);

  // Kick off family init on mount — but only once per family, ever.
  useEffect(() => {
    if (phrase) {
      // Already created — just show it again.
      setLoading(false);
      return;
    }
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    const run = async () => {
      const pubKey = useAuthStore.getState().pendingDevicePubKey;
      if (!pubKey) {
        setError(t("errors.generic"));
        setLoading(false);
        return;
      }
      try {
        const result = await initFamilyAndShowPhrase({
          devicePubKey: pubKey,
        });
        authStore.clearPendingKeypair();
        onPhraseReady(result.phrase);
      } catch (e: unknown) {
        logger.warn(
          "onboarding.recovery.init.failed",
          e instanceof Error ? e : new Error(String(e)),
        );
        setError(t("onboarding.recovery.initFailed"));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "0 var(--space-6)",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "32px",
            height: "32px",
            border: "3px solid var(--color-border-strong)",
            borderTopColor: "var(--color-primary)",
            borderRadius: "50%",
            animation: "spin 600ms linear infinite",
          }}
        />
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {t("onboarding.recovery.generating")}
        </p>
      </div>
    );
  }

  if (error || !phrase) {
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "0 var(--space-6)",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-expense)",
            margin: 0,
          }}
        >
          {error ?? t("errors.generic")}
        </p>
        <button style={skipLinkStyle} onClick={onNext}>
          {t("common.skip")}
        </button>
      </div>
    );
  }

  return <RecoveryCodeSetup phrase={phrase} onContinue={onNext} />;
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

export default function OnboardingFlow({
  initialStep,
}: {
  initialStep?: OnboardingInitialStep;
} = {}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const settingsStore = useSettingsStore();

  const [step, setStep] = useState(() => initialStepIndex(initialStep));
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
  // Lifted out of StepRecoveryCode so a remount of that step (e.g. forward
  // navigation revisiting it) can re-show the already-generated phrase
  // instead of re-running family init.
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  const handleNumpadSave = (result: number) => {
    const scale = Math.pow(10, getCurrencyDecimalPlaces(currency));
    setStartingBalance(result);
    setNumpadValue(String(result / scale));
    goToStep(5);
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
      // Guard against re-running handleFinish (e.g. a double-tap, or a retry
      // after a previous partial failure): if onboarding is already marked
      // complete, or seed data already exists, don't duplicate anything —
      // just finish the flow.
      if (settingsStore.hasCompletedOnboarding) {
        navigate(`/${settingsStore.startupScreen}`, { replace: true });
        return;
      }

      const [existingAccountCount, existingCategoryCount] = await Promise.all([
        db.accounts.count(),
        db.categories.count(),
      ]);
      const alreadySeeded = existingAccountCount > 0 || existingCategoryCount > 0;

      if (skipAccount || alreadySeeded) {
        await settingsStore.update("hasCompletedOnboarding", true);
      } else {
        const now = new Date().toISOString();
        const selectedPresets = DEFAULT_CATEGORY_PRESETS.filter((_, i) => categorySelected[i]);

        // Account + categories + settings are written atomically: a failure
        // partway through (e.g. quota exceeded) must not leave a partial
        // seed that duplicates on retry.
        await db.transaction("rw", db.accounts, db.categories, db.settings, async () => {
          // 1. Create first account
          if (accountName.trim()) {
            await db.accounts.add({
              name: accountName.trim(),
              type: "REGULAR",
              color: PRIMARY_ACCENT_COLOR,
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

          // 2. Create selected category presets
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

          // 3. Save main currency + mark onboarding complete
          await db.settings.put({ key: "mainCurrency", value: currency });
          await db.settings.put({ key: "hasCompletedOnboarding", value: true });
        });

        useSettingsStore.setState({ mainCurrency: currency, hasCompletedOnboarding: true });
        pushSetting("mainCurrency", currency).catch(() => {});
      }

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

  // Returning to the startup screen instead of continuing through
  // welcome/currency/categories only makes sense when the user is
  // re-authenticating via `/signin` on a device that already completed
  // onboarding — never for a fresh onboarding run.
  const isReturningSignIn = initialStep === "sign-in" && settingsStore.hasCompletedOnboarding;

  // After sign-in completes (step 0), determine next step based on needsFamilyInit.
  // A solo user upgrading to cloud sync (needsFamilyInit=true) ALWAYS needs the
  // recovery-code step to run — that's what actually creates the family and
  // shows the phrase — even if onboarding was already completed, otherwise
  // sign-in is a dead end with no family ever created.
  const handleSignInNext = () => {
    const { isSignedIn, needsFamilyInit } = useAuthStore.getState();
    if (isSignedIn && needsFamilyInit) {
      goToStep(1); // Recovery code step
      return;
    }
    if (isReturningSignIn) {
      navigate(`/${settingsStore.startupScreen}`, { replace: true });
      return;
    }
    goToStep(2); // Skip to Welcome
  };

  // Mirrors handleSignInNext's completed-onboarding guard so "Skip" from the
  // sign-in step doesn't re-run onboarding / re-seed for a returning user.
  const handleSkipSignIn = () => {
    if (isReturningSignIn) {
      navigate(`/${settingsStore.startupScreen}`, { replace: true });
      return;
    }
    goToStep(2);
  };

  // After the recovery-code step finishes (family created + phrase shown),
  // a re-authenticating already-onboarded user returns to their startup tab
  // instead of continuing into Welcome/currency/categories.
  const handleRecoveryCodeNext = () => {
    if (isReturningSignIn) {
      navigate(`/${settingsStore.startupScreen}`, { replace: true });
      return;
    }
    goToStep(2);
  };

  // Back from Welcome (2) must skip the recovery-code step (1) — re-entering
  // it would remount StepRecoveryCode and, without the phrase already being
  // cached in `recoveryPhrase`, re-run family init.
  const handleBack = () => {
    if (step === 2) {
      goToStep(0);
      return;
    }
    goToStep(step - 1);
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
        @keyframes spin { to { transform: rotate(360deg); } }
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
          <ProgressDots current={step} onBack={step > 0 ? handleBack : undefined} />
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
            {step === 0 && <SignInStep onNext={handleSignInNext} onSkip={handleSkipSignIn} />}
            {step === 1 && (
              <StepRecoveryCode
                onNext={handleRecoveryCodeNext}
                phrase={recoveryPhrase}
                onPhraseReady={setRecoveryPhrase}
              />
            )}
            {step === 2 && <StepWelcome onNext={() => goToStep(3)} onSkip={skipToComplete} />}
            {step === 3 && (
              <StepCurrency
                currency={currency}
                onChange={setCurrency}
                onNext={() => goToStep(4)}
                onSkip={skipToComplete}
              />
            )}
            {step === 4 && (
              <StepAccount
                accountName={accountName}
                onAccountNameChange={setAccountName}
                numpadValue={numpadValue}
                onNumpadChange={setNumpadValue}
                onNumpadSave={handleNumpadSave}
                currencyCode={currency}
                onNext={() => {
                  const dp = getCurrencyDecimalPlaces(currency);
                  const scale = Math.pow(10, dp);
                  const result = evaluateExpression(numpadValue, dp);
                  if (result !== null) {
                    setStartingBalance(result);
                    setNumpadValue(String(result / scale));
                  } else {
                    setStartingBalance(0);
                    setNumpadValue("");
                  }
                  goToStep(5);
                }}
                onSkip={skipToComplete}
              />
            )}
            {step === 5 && (
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
        {error && (
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-expense)",
              margin: "0 var(--space-4) var(--space-4)",
              textAlign: "center",
            }}
          >
            {error}
          </p>
        )}
        {isSaving && (
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
              margin: "0 var(--space-4) var(--space-4)",
              textAlign: "center",
            }}
          >
            {t("common.save")}…
          </p>
        )}
      </div>
    </>
  );
}
