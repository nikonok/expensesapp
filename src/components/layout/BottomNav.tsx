import { useLocation, useNavigate } from "react-router";
import { flushSync } from "react-dom";
import { Wallet, Tag, ArrowLeftRight, Target, LayoutDashboard } from "lucide-react";
import type { TabName } from "../../types";
import { useUIStore } from "../../stores/ui-store";

interface Tab {
  name: TabName;
  path: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

const TABS: Tab[] = [
  { name: "accounts", path: "/accounts", label: "Accounts", Icon: Wallet },
  { name: "categories", path: "/categories", label: "Categories", Icon: Tag },
  { name: "transactions", path: "/transactions", label: "Transactions", Icon: ArrowLeftRight },
  { name: "budget", path: "/budget", label: "Budget", Icon: Target },
  { name: "overview", path: "/overview", label: "Overview", Icon: LayoutDashboard },
];

function navigateWithTransition(navigate: ReturnType<typeof useNavigate>, path: string) {
  if ("startViewTransition" in document) {
    document.startViewTransition(() => {
      flushSync(() => navigate(path));
    });
  } else {
    navigate(path);
  }
}

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = TABS.find((t) => location.pathname.startsWith(t.path))?.name ?? "accounts";
  const resetTransactionsFilter = useUIStore((s) => s.resetTransactionsFilter);

  return (
    <nav
      style={{
        height: "var(--nav-height)",
        background: "var(--color-surface)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        zIndex: "var(--z-nav)",
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.name;
        return (
          <button
            key={tab.name}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              if (!isActive) {
                if (tab.name === "transactions") resetTransactionsFilter();
                navigateWithTransition(navigate, tab.path);
              }
            }}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              background: "none",
              border: "none",
              cursor: "pointer",
              position: "relative",
              paddingTop: "10px",
              paddingBottom: "10px",
              color: isActive ? "var(--color-primary)" : "var(--color-text-disabled)",
              transition: "color 150ms ease-out",
            }}
          >
            {/* Active indicator line */}
            <span
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: isActive ? "translateX(-50%) scaleX(1)" : "translateX(-50%) scaleX(0)",
                width: "24px",
                height: "2px",
                background: "var(--color-primary)",
                borderRadius: "0 0 2px 2px",
                transition: "transform 150ms ease-out",
              }}
            />

            <span
              style={
                isActive ? { filter: "drop-shadow(0 0 6px oklch(72% 0.22 210 / 70%))" } : undefined
              }
            >
              <tab.Icon size={20} strokeWidth={1.5} />
            </span>

            {isActive && (
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  fontFamily: "DM Sans, sans-serif",
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                {tab.label}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
