import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useAuthStore } from "../services/auth/session";

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
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
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

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "18px",
        height: "18px",
        border: "2px solid var(--color-bg)",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 600ms linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

export function SignInStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isSigningIn, error, errorStatus, signIn } = useAuthStore();

  const handleSignIn = async () => {
    await signIn();
    const state = useAuthStore.getState();
    // Advance only if sign-in succeeded (no error set means success).
    if (state.error) return;
    // If this device is awaiting an envelope from an existing device, jump
    // directly to the waiting screen instead of running through onboarding.
    if (state.awaitingEnvelope) {
      navigate("/devices/waiting", { replace: true });
      return;
    }
    onNext();
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
              fontSize: "var(--text-heading)",
              color: "var(--color-primary)",
              margin: 0,
              lineHeight: 1.2,
              textShadow: "0 0 40px oklch(72% 0.22 210 / 40%)",
            }}
          >
            {t("onboarding.signin.title")}
          </h1>
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-body)",
              color: "var(--color-text-secondary)",
              margin: 0,
            }}
          >
            {t("onboarding.signin.subtitle")}
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
            {t("onboarding.signin.body")}
          </p>
        </div>
        <div
          style={{ width: "100%", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
        >
          <button
            style={{
              ...primaryBtnStyle,
              opacity: isSigningIn ? 0.7 : 1,
              cursor: isSigningIn ? "not-allowed" : "pointer",
            }}
            onClick={() => void handleSignIn()}
            disabled={isSigningIn}
          >
            {isSigningIn && <Spinner />}
            {t("onboarding.signin.google_button")}
          </button>
          {error && (
            <p
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-expense)",
                margin: "var(--space-1) 0 0",
              }}
            >
              {errorStatus === 403
                ? t("onboarding.signin.error_forbidden")
                : t("onboarding.signin.error_fallback")}
            </p>
          )}
          <button style={skipLinkStyle} onClick={onSkip}>
            {t("onboarding.signin.skip")}
          </button>
        </div>
      </div>
    </>
  );
}
