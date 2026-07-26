import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useAuthStore } from "../services/auth/session";
import { renderGoogleSignInButton } from "../services/auth/google";

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [gsiUnavailable, setGsiUnavailable] = useState(false);

  // Exchange the Google credential for a backend session, then advance. Kept in
  // a ref so the button (rendered once, below) always calls the latest closure.
  const completeSignIn = useCallback(
    async (idToken: string) => {
      await signIn(idToken);
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
    },
    [signIn, navigate, onNext],
  );
  const completeRef = useRef(completeSignIn);
  completeRef.current = completeSignIn;

  // Render Google's real "Sign in with Google" button once, invisibly, on top of
  // the styled cyan button below. Google's element captures the tap and drives
  // the popup sign-in flow — reliable on mobile where One Tap is suppressed.
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
    const overlay = overlayRef.current;
    const wrap = wrapRef.current;
    if (!overlay || !wrap) return;
    if (!clientId) {
      setGsiUnavailable(true);
      return;
    }
    const width = Math.min(Math.round(wrap.getBoundingClientRect().width) || 320, 400);
    renderGoogleSignInButton({
      container: overlay,
      clientId,
      width,
      onCredential: (idToken) => void completeRef.current(idToken),
    }).catch(() => setGsiUnavailable(true));
    return () => {
      overlay.innerHTML = "";
    };
  }, []);

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        /* Enlarge the (invisible) Google button so its clickable area covers the
           full height of the cyan button beneath it, leaving no dead tap zones. */
        .gsi-overlay > div { transform: scale(1.4); }
      `}</style>
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
          <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
            {/* Presentational button. The invisible Google button overlaid on
                top captures the tap and drives the actual sign-in. */}
            <div
              aria-hidden
              style={{
                ...primaryBtnStyle,
                cursor: "default",
                opacity: isSigningIn ? 0.7 : 1,
              }}
            >
              {isSigningIn && <Spinner />}
              {t("onboarding.signin.google_button")}
            </div>
            {/* Google's real button: invisible, scaled to cover the whole area
                so any tap on the cyan button triggers it. */}
            <div
              ref={overlayRef}
              className="gsi-overlay"
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: isSigningIn ? "none" : "auto",
              }}
            />
          </div>
          {(error || gsiUnavailable) && (
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
