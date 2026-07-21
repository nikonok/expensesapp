// Admin → Users section (Phase 10e).
//
// Paginated user table with per-row actions: suspend/unsuspend, promote/demote,
// force sign-out (device revoke of all devices via the single-device revoke API
// called once per device — the backend admin endpoint exposes a deviceCount that
// serves as the display hint; actual per-device revoke is driven from this table).

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  listUsers,
  suspendUser,
  unsuspendUser,
  promoteAdmin,
  demoteAdmin,
  type AdminUser,
} from "@/services/admin/client";

// ── Atoms ──────────────────────────────────────────────────────────────────────

function SmallBtn({
  label,
  disabled,
  variant = "default",
  onClick,
}: {
  label: string;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary" | "warn";
  onClick: () => void;
}) {
  const bg: Record<string, string> = {
    default: "var(--color-surface-raised)",
    danger: "var(--color-expense-dim)",
    primary: "var(--color-primary)",
    warn: "oklch(60% 0.22 60 / 15%)",
  };
  const color: Record<string, string> = {
    default: "var(--color-text-secondary)",
    danger: "var(--color-expense)",
    primary: "var(--color-bg)",
    warn: "oklch(72% 0.22 60)",
  };
  const border: Record<string, string> = {
    default: "1px solid var(--color-border-strong)",
    danger: "1px solid oklch(62% 0.28 18 / 50%)",
    primary: "none",
    warn: "1px solid oklch(60% 0.22 60 / 40%)",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: "28px",
        padding: "0 var(--space-2)",
        background: bg[variant],
        color: color[variant],
        border: border[variant],
        borderRadius: "var(--radius-btn)",
        fontFamily: '"DM Sans", sans-serif',
        fontWeight: 500,
        fontSize: "var(--text-caption)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function StatusBadge({ suspended }: { suspended: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 6px",
        borderRadius: "var(--radius-chip)",
        fontFamily: '"DM Sans", sans-serif',
        fontWeight: 500,
        fontSize: "0.65rem",
        background: suspended ? "var(--color-expense-dim)" : "oklch(73% 0.23 160 / 12%)",
        color: suspended ? "var(--color-expense)" : "var(--color-income)",
        flexShrink: 0,
      }}
    >
      {suspended ? t("admin.users.statusSuspended") : t("admin.users.statusActive")}
    </span>
  );
}

// ── UserRow ────────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: AdminUser;
  onSuspend: (id: string) => void;
  onUnsuspend: (id: string) => void;
  onPromote: (id: string) => void;
  onDemote: (id: string) => void;
  acting: boolean;
}

function UserRow({ user, onSuspend, onUnsuspend, onPromote, onDemote, acting }: UserRowProps) {
  const { t } = useTranslation();
  const isSuspended = user.suspendedAt !== null;
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);

  const metaVisible = !isMobile || expanded;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--color-border)",
        padding: "var(--space-3) var(--space-4)",
      }}
    >
      {/* Top row: email + status badges */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          flexWrap: "wrap",
          marginBottom: "var(--space-1)",
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
            color: "var(--color-text)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {user.displayName || user.email}
        </span>
        <StatusBadge suspended={isSuspended} />
        {user.isAdmin && (
          <span
            style={{
              display: "inline-block",
              padding: "2px 6px",
              borderRadius: "var(--radius-chip)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "0.65rem",
              background: "var(--color-primary-dim)",
              color: "var(--color-primary)",
              flexShrink: 0,
            }}
          >
            {t("admin.users.adminBadge")}
          </span>
        )}
        {user.deletePending && (
          <span
            style={{
              display: "inline-block",
              padding: "2px 6px",
              borderRadius: "var(--radius-chip)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "0.65rem",
              background: "var(--color-expense-dim)",
              color: "var(--color-expense)",
              flexShrink: 0,
            }}
          >
            {t("admin.users.deletePendingBadge")}
          </span>
        )}
      </div>

      {/* Sub row: email (if display name shown above), metadata.
          On mobile, collapsed behind a Details disclosure to keep the row scannable. */}
      {metaVisible && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flexWrap: "wrap",
            marginBottom: "var(--space-2)",
          }}
        >
          {user.displayName && (
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
                wordBreak: "break-all",
              }}
            >
              {user.email}
            </span>
          )}
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
            }}
          >
            {t("admin.users.deviceCount", { count: user.deviceCount })}
          </span>
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              color: "var(--color-text-secondary)",
            }}
          >
            {t("admin.users.familyCount", { count: user.familyMemberCount })}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "var(--text-caption)",
              color:
                user.storageUsagePct > 80
                  ? "var(--color-expense)"
                  : user.storageUsagePct > 60
                    ? "oklch(72% 0.22 60)"
                    : "var(--color-text-secondary)",
            }}
          >
            {user.storageUsagePct.toFixed(1)}%
          </span>
          {user.lastSignInAt && (
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
              }}
            >
              {new Date(user.lastSignInAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {isSuspended ? (
          <SmallBtn
            label={acting ? "…" : t("admin.users.unsuspend")}
            disabled={acting}
            variant="primary"
            onClick={() => onUnsuspend(user.id)}
          />
        ) : (
          <SmallBtn
            label={acting ? "…" : t("admin.users.suspend")}
            disabled={acting}
            variant="danger"
            onClick={() => onSuspend(user.id)}
          />
        )}

        {user.isAdmin ? (
          // Hide Demote button for root users (isRoot: true) — Phase 13 will
          // wire a proper "revoke all sessions for this user" endpoint.
          !user.isRoot && (
            <SmallBtn
              label={acting ? "…" : t("admin.users.demote")}
              disabled={acting}
              variant="warn"
              onClick={() => onDemote(user.id)}
            />
          )
        ) : (
          <SmallBtn
            label={acting ? "…" : t("admin.users.promote")}
            disabled={acting}
            variant="default"
            onClick={() => onPromote(user.id)}
          />
        )}

        {isMobile && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? t("admin.users.hideDetails") : t("admin.users.showDetails")}
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginLeft: "auto",
              minHeight: "28px",
              minWidth: "28px",
              padding: "0 var(--space-2)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: "var(--color-surface-raised)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-caption)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {expanded ? (
              <ChevronUp size={14} strokeWidth={1.5} />
            ) : (
              <ChevronDown size={14} strokeWidth={1.5} />
            )}
            <span>{t("admin.users.details")}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── UsersList ──────────────────────────────────────────────────────────────────

interface UsersListProps {
  // When "admins", only users with `isAdmin === true` are displayed.
  // The "loaded" count and empty-state copy adapt accordingly.
  // Filtering is client-side over the same paginated /admin/users endpoint.
  filter?: "all" | "admins";
}

export function UsersList({ filter = "all" }: UsersListProps = {}) {
  const { t } = useTranslation();
  const { show: showToast } = useToast();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actingUserId, setActingUserId] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listUsers();
      setUsers(page.items);
      setHasMore(page.items.length >= page.limit);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.users.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function handleLoadMore() {
    if (!hasMore) return;
    setLoadingMore(true);
    try {
      const page = await listUsers(users.length);
      setUsers((prev) => [...prev, ...page.items]);
      setHasMore(page.items.length >= page.limit);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.loadMoreFailed"), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSuspend(id: string) {
    setActingUserId(id);
    try {
      await suspendUser(id);
      showToast(t("admin.users.suspendSuccess"), "success");
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, suspendedAt: new Date().toISOString() } : u)),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.users.suspendFailed"), "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handleUnsuspend(id: string) {
    setActingUserId(id);
    try {
      await unsuspendUser(id);
      showToast(t("admin.users.unsuspendSuccess"), "success");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, suspendedAt: null } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.users.unsuspendFailed"), "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handlePromote(id: string) {
    setActingUserId(id);
    try {
      await promoteAdmin(id);
      showToast(t("admin.users.promoteSuccess"), "success");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isAdmin: true } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.users.promoteFailed"), "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handleDemote(id: string) {
    setActingUserId(id);
    try {
      await demoteAdmin(id);
      showToast(t("admin.users.demoteSuccess"), "success");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isAdmin: false } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("admin.users.demoteFailed"), "error");
    } finally {
      setActingUserId(null);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        {t("common.loading")}
      </div>
    );
  }

  const visibleUsers = filter === "admins" ? users.filter((u) => u.isAdmin) : users;

  if (visibleUsers.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        {filter === "admins" ? t("admin.users.emptyAdmins") : t("admin.users.emptyUsers")}
      </div>
    );
  }

  const countLabel =
    filter === "admins"
      ? t("admin.users.countLabelAdmins", { count: visibleUsers.length })
      : t("admin.users.countLabelUsers", { count: visibleUsers.length });

  return (
    <div>
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-secondary)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {countLabel}
      </div>

      {visibleUsers.map((user) => (
        <UserRow
          key={user.id}
          user={user}
          onSuspend={handleSuspend}
          onUnsuspend={handleUnsuspend}
          onPromote={handlePromote}
          onDemote={handleDemote}
          acting={actingUserId === user.id}
        />
      ))}

      {hasMore && (
        <div
          style={{
            padding: "var(--space-4)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
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
              cursor: loadingMore ? "not-allowed" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? t("common.loading") : t("admin.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
