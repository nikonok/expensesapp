import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface RecoveryCodeSetupProps {
  phrase: string;
  onContinue: () => void;
}

export function RecoveryCodeSetup({ phrase, onContinue }: RecoveryCodeSetupProps) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const words = phrase.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: "0 var(--space-4)",
        overflowY: "auto",
      }}
    >
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
          {t("onboarding.recovery.title")}
        </h2>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          {t("onboarding.recovery.subtitle")}
        </p>
      </div>

      {/* 4-column word grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "var(--space-2)",
          marginBottom: "var(--space-5)",
        }}
      >
        {words.map((word, i) => (
          <div
            key={i}
            style={{
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
              padding: "var(--space-2) var(--space-1)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2px",
              minHeight: "52px",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-disabled)",
                lineHeight: 1,
              }}
            >
              {i + 1}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 500,
                fontSize: "0.7rem",
                color: "var(--color-text)",
                wordBreak: "break-all",
                textAlign: "center",
                lineHeight: 1.2,
              }}
            >
              {word}
            </span>
          </div>
        ))}
      </div>

      {/* Confirmation checkbox */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-3)",
          cursor: "pointer",
          marginBottom: "var(--space-5)",
          minHeight: "44px",
          padding: "var(--space-2) 0",
        }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={{
            width: "20px",
            height: "20px",
            flexShrink: 0,
            marginTop: "2px",
            accentColor: "var(--color-primary)",
            cursor: "pointer",
          }}
        />
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            lineHeight: 1.4,
          }}
        >
          {t("onboarding.recovery.confirmLabel")}
        </span>
      </label>

      {/* Continue button */}
      <button
        onClick={onContinue}
        disabled={!confirmed}
        style={{
          minHeight: "52px",
          width: "100%",
          background: confirmed ? "var(--color-primary)" : "var(--color-surface-raised)",
          color: confirmed ? "var(--color-bg)" : "var(--color-text-disabled)",
          border: "none",
          borderRadius: "var(--radius-btn)",
          fontFamily: '"Syne", sans-serif',
          fontWeight: 700,
          fontSize: "1rem",
          letterSpacing: "0.05em",
          cursor: confirmed ? "pointer" : "not-allowed",
          boxShadow: confirmed ? "0 4px 16px oklch(72% 0.22 210 / 30%)" : "none",
          transition: "background 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out",
        }}
      >
        {t("common.next")}
      </button>
    </div>
  );
}
