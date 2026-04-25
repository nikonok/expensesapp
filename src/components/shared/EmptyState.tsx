import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, heading, body, action }: EmptyStateProps) {
  return (
    <div
      style={{
        minHeight: "50dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <Icon
        size={64}
        strokeWidth={1.5}
        style={{ color: "var(--color-text-disabled)", flexShrink: 0 }}
      />
      <h2
        style={{
          fontFamily: "Syne, sans-serif",
          fontWeight: 700,
          fontSize: "var(--text-heading)",
          color: "var(--color-text-secondary)",
          margin: 0,
        }}
      >
        {heading}
      </h2>
      {body && (
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
            maxWidth: "28ch",
          }}
        >
          {body}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            minHeight: "44px",
            padding: "0 var(--space-6)",
            background: "var(--color-surface-raised)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "var(--radius-btn)",
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
