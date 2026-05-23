// Full-screen waiting view — shown when the user signed in on a new device
// and the response carried `awaitingEnvelope: true`.
//
// Shows "Waiting for approval…" with a pulse animation.
// After 30s, surfaces a "Enter recovery code instead" link.
// Architecture §8.2, Phase 5e.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

export default function DeviceJoinWaiting() {
  const navigate = useNavigate();
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowRecovery(true), 30_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        background: "var(--color-bg)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      {/* Pulse animation */}
      <div
        style={{
          position: "relative",
          width: 72,
          height: 72,
          marginBottom: "var(--space-6)",
        }}
      >
        {/* Outer ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2px solid var(--color-primary)",
            opacity: 0.3,
            animation: "pulse-ring 2s ease-out infinite",
          }}
        />
        {/* Inner dot */}
        <div
          style={{
            position: "absolute",
            inset: 12,
            borderRadius: "50%",
            background: "var(--color-primary)",
            opacity: 0.8,
            animation: "pulse-dot 2s ease-in-out infinite",
          }}
        />
      </div>

      <h1
        style={{
          fontFamily: '"Syne", sans-serif',
          fontWeight: 700,
          fontSize: "var(--text-title)",
          color: "var(--color-text)",
          margin: 0,
          marginBottom: "var(--space-3)",
        }}
      >
        Waiting for approval
      </h1>

      <p
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-muted)",
          margin: 0,
          marginBottom: "var(--space-8)",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        Open the app on one of your other devices to approve this sign-in.
      </p>

      {showRecovery && (
        <button
          onClick={() => navigate("/onboarding")}
          style={{
            background: "none",
            border: "none",
            padding: "var(--space-2) var(--space-4)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-primary)",
            cursor: "pointer",
            textDecoration: "underline",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          Enter recovery code instead
        </button>
      )}

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.9); opacity: 0.5; }
          70% { transform: scale(1.3); opacity: 0; }
          100% { transform: scale(1.3); opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { transform: scale(0.9); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
