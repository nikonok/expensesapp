// Thin page wrapper around RecoveryCodeSetup for use from Settings → Security (Phase 6).
// No route is wired yet — this file is pre-created for Phase 6.

import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { RecoveryCodeSetup } from "../components/onboarding/RecoveryCodeSetup";

interface RecoveryCodePageProps {
  /** Pre-loaded phrase to display. Caller is responsible for decrypting it first. */
  phrase: string;
  onDone?: () => void;
}

export function RecoveryCodePage({ phrase, onDone }: RecoveryCodePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleContinue = () => {
    if (onDone) {
      onDone();
    } else {
      navigate(-1);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        maxWidth: "480px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <header
        style={{
          minHeight: "56px",
          display: "flex",
          alignItems: "center",
          paddingInline: "var(--space-4)",
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
          gap: "var(--space-3)",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label={t("common.back")}
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
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <h1
          style={{
            flex: 1,
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {t("onboarding.recovery.title")}
        </h1>
        {/* Spacer to balance back button */}
        <div style={{ minWidth: "44px" }} />
      </header>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: "var(--space-4) 0 var(--space-6)",
        }}
      >
        <RecoveryCodeSetup phrase={phrase} onContinue={handleContinue} />
      </div>
    </div>
  );
}
