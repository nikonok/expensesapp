import type { ReactNode } from "react";
import { ArrowDownToLine, RefreshCw, Settings, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useInstallPrompt } from "../../hooks/use-install-prompt";
import { useSwUpdate } from "../../hooks/use-sw-update";

interface TopBarProps {
  title: string;
  rightSlot?: ReactNode;
}

export default function TopBar({ title, rightSlot }: TopBarProps) {
  const navigate = useNavigate();
  const { canInstall, install, dismiss: dismissInstall } = useInstallPrompt();
  const { updateAvailable, update, dismiss: dismissUpdate } = useSwUpdate();

  const bothVisible = canInstall && updateAvailable;

  return (
    <header
      className="app-bar"
      style={{
        minHeight: "56px",
        display: "flex",
        alignItems: "center",
        paddingInline: "var(--space-4)",
        paddingBlock: bothVisible ? "8px" : "0",
        background: "var(--color-bg)",
        borderBottom: "1px solid transparent",
        position: "sticky",
        top: 0,
        zIndex: "var(--z-sticky)",
        flexShrink: 0,
      }}
    >
      <button
        aria-label="Open settings"
        onClick={() => navigate("/settings")}
        style={{
          minWidth: "44px",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-text-secondary)",
          padding: 0,
        }}
      >
        <Settings size={20} strokeWidth={1.5} />
      </button>

      <h1
        style={{
          flex: 1,
          textAlign: "center",
          fontFamily: "Syne, sans-serif",
          fontWeight: 700,
          fontSize: "var(--text-heading)",
          color: "var(--color-text)",
          margin: 0,
        }}
      >
        {title}
      </h1>

      <div
        style={{
          minWidth: "44px",
          display: "flex",
          flexDirection: bothVisible ? "column" : "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: "4px",
        }}
      >
        {updateAvailable && (
          <Pill
            color="var(--color-income)"
            glow="oklch(73% 0.23 160 / 30%)"
            onAction={() => {
              void update();
            }}
            onDismiss={dismissUpdate}
            actionLabel="Update"
            dismissLabel="Dismiss update"
            icon={<RefreshCw size={12} strokeWidth={2} />}
          />
        )}
        {canInstall && (
          <Pill
            color="var(--color-primary)"
            glow="oklch(72% 0.22 210 / 30%)"
            onAction={() => {
              void install();
            }}
            onDismiss={dismissInstall}
            actionLabel="Install"
            dismissLabel="Dismiss install prompt"
            icon={<ArrowDownToLine size={12} strokeWidth={2} />}
          />
        )}
        {!canInstall && !updateAvailable && rightSlot}
      </div>
    </header>
  );
}

interface PillProps {
  color: string;
  glow: string;
  onAction: () => void;
  onDismiss: () => void;
  actionLabel: string;
  dismissLabel: string;
  icon?: ReactNode;
}

function Pill({ color, glow, onAction, onDismiss, actionLabel, dismissLabel, icon }: PillProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: color,
        borderRadius: "999px",
        paddingLeft: "12px",
        paddingRight: "4px",
        height: "32px",
        boxShadow: `0 4px 16px ${glow}`,
      }}
    >
      <button
        onClick={onAction}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-bg)",
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: "12px",
          padding: "16px 2px",
          margin: "-16px 0",
          lineHeight: 1,
        }}
      >
        {icon}
        <span>{actionLabel}</span>
      </button>
      <button
        aria-label={dismissLabel}
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "20px",
          height: "20px",
          padding: "12px",
          margin: "-12px",
          boxSizing: "content-box",
        }}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
