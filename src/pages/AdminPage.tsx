// Admin panel page (Phase 10e).
//
// Full-screen page at /admin. Only reachable by users with isAdmin=true.
// Sidebar navigation (Users, Allowlist, Admins, Audit) with right-pane content
// on viewports ≥ 600 px; on narrower viewports the sidebar collapses into a
// horizontal scrollable tab strip stacked above the content pane.

import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Users, Shield, List, FileText } from "lucide-react";
import { UsersList } from "@/components/admin/UsersList";
import { AllowlistEditor } from "@/components/admin/AllowlistEditor";
import { AuditViewer } from "@/components/admin/AuditViewer";
import { useIsMobile } from "@/hooks/use-is-mobile";

type AdminSection = "users" | "allowlist" | "admins" | "audit";

interface NavEntry {
  id: AdminSection;
  label: string;
  icon: React.ReactNode;
}

const NAV_ENTRIES: NavEntry[] = [
  { id: "users", label: "Users", icon: <Users size={16} strokeWidth={1.5} /> },
  { id: "allowlist", label: "Allowlist", icon: <List size={16} strokeWidth={1.5} /> },
  { id: "admins", label: "Admins", icon: <Shield size={16} strokeWidth={1.5} /> },
  { id: "audit", label: "Audit", icon: <FileText size={16} strokeWidth={1.5} /> },
];

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SidebarNavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        minHeight: "44px",
        width: "100%",
        padding: "0 var(--space-4)",
        background: active ? "var(--color-primary-dim)" : "none",
        border: "none",
        borderLeft: active ? "3px solid var(--color-primary)" : "3px solid transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        style={{
          color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: "var(--text-body)",
          color: active ? "var(--color-text)" : "var(--color-text-secondary)",
        }}
      >
        {label}
      </span>
    </button>
  );
}

function TabChip({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      style={{
        flexShrink: 0,
        minHeight: "44px",
        padding: "0 var(--space-4)",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        background: active ? "var(--color-primary)" : "var(--color-surface)",
        color: active ? "var(--color-bg)" : "var(--color-text-secondary)",
        border: `1px solid ${active ? "transparent" : "var(--color-border)"}`,
        borderRadius: "var(--radius-chip)",
        fontFamily: '"DM Sans", sans-serif',
        fontWeight: 500,
        fontSize: "var(--text-caption)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        filter: active ? "drop-shadow(0 0 6px oklch(72% 0.22 210 / 50%))" : "none",
        transition: "background 100ms ease-out, color 100ms ease-out, filter 100ms ease-out",
      }}
    >
      <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "var(--space-4) var(--space-4) var(--space-2)",
        fontFamily: "Syne, sans-serif",
        fontWeight: 700,
        fontSize: "var(--text-heading)",
        color: "var(--color-text)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {label}
    </div>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [section, setSection] = useState<AdminSection>("users");
  const isMobile = useIsMobile();

  function renderContent() {
    switch (section) {
      case "users":
        return (
          <>
            <SectionTitle label="Users" />
            <UsersList filter="all" />
          </>
        );
      case "allowlist":
        return (
          <>
            <SectionTitle label="Allowlist" />
            <AllowlistEditor />
          </>
        );
      case "admins":
        return (
          <>
            <SectionTitle label="Admins" />
            <UsersList filter="admins" />
          </>
        );
      case "audit":
        return (
          <>
            <SectionTitle label="Audit Log" />
            <AuditViewer />
          </>
        );
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: "var(--color-bg)",
        maxWidth: "960px",
        marginInline: "auto",
        width: "100%",
      }}
    >
      {/* Top bar */}
      <header
        style={{
          height: "56px",
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
          aria-label="Go back"
          onClick={() => navigate(-1)}
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
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>

        <h1
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          Admin
        </h1>

        {/* Admin badge — hidden on very narrow viewports to free header space. */}
        {!isMobile && (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: "var(--radius-chip)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-caption)",
              background: "var(--color-primary-dim)",
              color: "var(--color-primary)",
            }}
          >
            Admin panel
          </span>
        )}
      </header>

      {isMobile ? (
        // ── Mobile: tab strip above content, single column ───────────────────
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <nav
            role="tablist"
            aria-label="Admin sections"
            style={{
              display: "flex",
              flexDirection: "row",
              gap: "var(--space-2)",
              overflowX: "auto",
              overflowY: "hidden",
              padding: "var(--space-3) var(--space-4)",
              borderBottom: "1px solid var(--color-border)",
              scrollbarWidth: "none",
              flexShrink: 0,
            }}
          >
            {NAV_ENTRIES.map((entry) => (
              <TabChip
                key={entry.id}
                icon={entry.icon}
                label={entry.label}
                active={section === entry.id}
                onClick={() => setSection(entry.id)}
              />
            ))}
          </nav>

          <main style={{ flex: 1, overflowY: "auto" }}>{renderContent()}</main>
        </div>
      ) : (
        // ── Desktop / tablet: sidebar + content ──────────────────────────────
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <nav
            style={{
              width: "180px",
              flexShrink: 0,
              borderRight: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              paddingTop: "var(--space-2)",
            }}
          >
            {NAV_ENTRIES.map((entry) => (
              <SidebarNavItem
                key={entry.id}
                icon={entry.icon}
                label={entry.label}
                active={section === entry.id}
                onClick={() => setSection(entry.id)}
              />
            ))}
          </nav>

          <main style={{ flex: 1, overflowY: "auto" }}>{renderContent()}</main>
        </div>
      )}
    </div>
  );
}
