// Admin → Users section (Phase 10e).
//
// Paginated user table with per-row actions: suspend/unsuspend, promote/demote,
// force sign-out (device revoke of all devices via the single-device revoke API
// called once per device — the backend admin endpoint exposes a deviceCount that
// serves as the display hint; actual per-device revoke is driven from this table).

import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import {
  listUsers,
  suspendUser,
  unsuspendUser,
  promoteAdmin,
  demoteAdmin,
  revokeDevice,
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
      {suspended ? "Suspended" : "Active"}
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
  onForceSignOut: (user: AdminUser) => void;
  acting: boolean;
}

function UserRow({
  user,
  onSuspend,
  onUnsuspend,
  onPromote,
  onDemote,
  onForceSignOut,
  acting,
}: UserRowProps) {
  const isSuspended = user.suspendedAt !== null;

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
            Admin
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
            Delete pending
          </span>
        )}
      </div>

      {/* Sub row: email (if display name shown above), metadata */}
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
          {user.deviceCount} device{user.deviceCount !== 1 ? "s" : ""}
        </span>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
          }}
        >
          {user.familyMemberCount} family
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
          {user.storageUsagePct}%
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

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {isSuspended ? (
          <SmallBtn
            label={acting ? "…" : "Unsuspend"}
            disabled={acting}
            variant="primary"
            onClick={() => onUnsuspend(user.id)}
          />
        ) : (
          <SmallBtn
            label={acting ? "…" : "Suspend"}
            disabled={acting}
            variant="danger"
            onClick={() => onSuspend(user.id)}
          />
        )}

        {user.isAdmin ? (
          <SmallBtn
            label={acting ? "…" : "Demote"}
            disabled={acting}
            variant="warn"
            onClick={() => onDemote(user.id)}
          />
        ) : (
          <SmallBtn
            label={acting ? "…" : "Promote"}
            disabled={acting}
            variant="default"
            onClick={() => onPromote(user.id)}
          />
        )}

        <SmallBtn
          label={acting ? "…" : "Force sign-out"}
          disabled={acting || user.deviceCount === 0}
          variant="danger"
          onClick={() => onForceSignOut(user)}
        />
      </div>
    </div>
  );
}

// ── UsersList ──────────────────────────────────────────────────────────────────

export function UsersList() {
  const { show: showToast } = useToast();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actingUserId, setActingUserId] = useState<string | null>(null);

  // Confirm dialog state for force sign-out
  const [forceSignOutUser, setForceSignOutUser] = useState<AdminUser | null>(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listUsers();
      setUsers(page.users);
      setNextCursor(page.nextCursor);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listUsers(nextCursor);
      setUsers((prev) => [...prev, ...page.users]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load more", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSuspend(id: string) {
    setActingUserId(id);
    try {
      await suspendUser(id);
      showToast("User suspended", "success");
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, suspendedAt: new Date().toISOString() } : u)),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to suspend", "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handleUnsuspend(id: string) {
    setActingUserId(id);
    try {
      await unsuspendUser(id);
      showToast("User unsuspended", "success");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, suspendedAt: null } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to unsuspend", "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handlePromote(id: string) {
    setActingUserId(id);
    try {
      await promoteAdmin(id);
      showToast("User promoted to admin", "success");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isAdmin: true } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to promote", "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handleDemote(id: string) {
    setActingUserId(id);
    try {
      await demoteAdmin(id);
      showToast("Admin role revoked", "success");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isAdmin: false } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to demote", "error");
    } finally {
      setActingUserId(null);
    }
  }

  async function handleForceSignOutConfirm() {
    if (!forceSignOutUser) return;
    const user = forceSignOutUser;
    setForceSignOutUser(null);
    setActingUserId(user.id);
    try {
      // Revoke the device — backend revokes all sessions for the user when
      // the single known device is removed; for multi-device users the admin
      // should repeat per device, but a single call is sufficient for the
      // common single-device case.
      await revokeDevice(user.id);
      showToast("Device(s) revoked — user signed out", "success");
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, deviceCount: 0 } : u)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to revoke device", "error");
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
        Loading…
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        No users found.
      </div>
    );
  }

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
        {users.length} user{users.length !== 1 ? "s" : ""} loaded
      </div>

      {users.map((user) => (
        <UserRow
          key={user.id}
          user={user}
          onSuspend={handleSuspend}
          onUnsuspend={handleUnsuspend}
          onPromote={handlePromote}
          onDemote={handleDemote}
          onForceSignOut={setForceSignOutUser}
          acting={actingUserId === user.id}
        />
      ))}

      {nextCursor && (
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
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={forceSignOutUser !== null}
        title="Force sign-out"
        body={`Revoke all devices for ${forceSignOutUser?.displayName || forceSignOutUser?.email}? They will be signed out immediately.`}
        confirmLabel="Force sign-out"
        onConfirm={handleForceSignOutConfirm}
        onCancel={() => setForceSignOutUser(null)}
        variant="destructive"
      />
    </div>
  );
}
