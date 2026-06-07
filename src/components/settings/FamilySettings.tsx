// Settings → Family section (architecture §8.7–§8.9, Phase 7e).
//
// Renders:
//   1. Family members list with per-row "Remove" button (not shown for self).
//   2. "Invite someone" input + Send button.
//   3. Incoming invites list with Accept / Decline buttons.
//      - Accept with solo data → 409 NeedsMigrationDecisionError → migration dialog.
//   4. "Leave family" button with confirm dialog.

import { useState, useEffect, useCallback } from "react";
import { ComingSoonStub } from "@/components/shared/ComingSoonStub";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import {
  createInvite,
  listIncomingInvites,
  listFamilyMembers,
  acceptInvite,
  declineInvite,
  leaveFamily,
  removeMember,
  NeedsMigrationDecisionError,
  type Invite,
  type FamilyMember,
} from "@/services/family/client";
// TODO(WORK_PLAN B5): re-enable with proper key wrap
// import { migrateSoloRecordsToFamily } from "@/services/family/migrate";

// ── Row atoms ─────────────────────────────────────────────────────────────────

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: '"DM Sans", sans-serif',
        fontWeight: 500,
        fontSize: "var(--text-body)",
        color: "var(--color-text)",
      }}
    >
      {children}
    </span>
  );
}

function RowSub({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: '"DM Sans", sans-serif',
        fontSize: "var(--text-caption)",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

function ActionButton({
  label,
  disabled,
  variant = "default",
  onClick,
}: {
  label: string;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
  onClick: () => void;
}) {
  const bgMap = {
    default: "var(--color-surface-raised)",
    danger: "var(--color-expense-dim)",
    primary: "var(--color-primary)",
  };
  const colorMap = {
    default: "var(--color-text-secondary)",
    danger: "var(--color-expense)",
    primary: "var(--color-bg)",
  };
  const borderMap = {
    default: "1px solid var(--color-border-strong)",
    danger: "1px solid oklch(62% 0.28 18 / 50%)",
    primary: "none",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: "32px",
        padding: "0 var(--space-3)",
        background: bgMap[variant],
        color: colorMap[variant],
        border: borderMap[variant],
        borderRadius: "var(--radius-btn)",
        fontFamily: '"DM Sans", sans-serif',
        fontWeight: 500,
        fontSize: "var(--text-caption)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

// ── Migration decision dialog ─────────────────────────────────────────────────

interface MigrationDialogProps {
  isOpen: boolean;
  // TODO(WORK_PLAN B5): re-enable with proper key wrap — these become
  // load-bearing again when the migrate button is wired to the worker.
  inviteId?: string;
  targetFamilyId?: string;
  onClose: () => void;
  onDone?: () => void;
}

function MigrationDialog({ isOpen, onClose }: MigrationDialogProps) {
  // TODO(WORK_PLAN B5): re-enable with proper key wrap.
  // The previous implementation encrypted migrated records under an
  // all-zero family key, which would silently corrupt them. The "Move my
  // data" button is wrapped in <ComingSoonStub> until B5 plumbs the real
  // wrapped key through the worker.

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="migration-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-dialog)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4)",
      }}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "oklch(0% 0 0 / 60%)",
        }}
      />

      <div
        style={{
          position: "relative",
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          padding: "var(--space-6)",
          width: "100%",
          maxWidth: "320px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <h2
          id="migration-dialog-title"
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: "var(--text-heading)",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          You have existing data
        </h2>
        <p
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          Your current records can be moved to the shared family, or you can start fresh and discard
          them.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {/* TODO(WORK_PLAN B5): re-enable with proper key wrap. */}
          <ComingSoonStub>
            <button
              type="button"
              style={{
                minHeight: "44px",
                width: "100%",
                background: "var(--color-primary)",
                color: "var(--color-bg)",
                border: "none",
                borderRadius: "var(--radius-btn)",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
                cursor: "pointer",
              }}
            >
              Move my data
            </button>
          </ComingSoonStub>

          <button
            onClick={onClose}
            style={{
              minHeight: "44px",
              background: "none",
              color: "var(--color-text-disabled)",
              border: "none",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 400,
              fontSize: "var(--text-caption)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FamilySettings ────────────────────────────────────────────────────────────

export function FamilySettings() {
  const { show: showToast } = useToast();

  // ── Members ────────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [removingMember, setRemovingMember] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const list = await listFamilyMembers();
      setMembers(list);
    } catch {
      // Solo user (no family yet) — show placeholder
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function handleRemoveMember(userId: string) {
    setRemovingMember(userId);
    try {
      await removeMember(userId);
      showToast("Member removed", "success");
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove member", "error");
    } finally {
      setRemovingMember(null);
    }
  }

  // ── Invite send ────────────────────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);

  async function handleSendInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteSending(true);
    try {
      await createInvite(email);
      showToast("Invite sent", "success");
      setInviteEmail("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send invite", "error");
    } finally {
      setInviteSending(false);
    }
  }

  // ── Incoming invites ───────────────────────────────────────────────────────
  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [actingInvite, setActingInvite] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const list = await listIncomingInvites();
      setInvites(list);
    } catch {
      setInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  // Migration dialog
  const [migrationDialog, setMigrationDialog] = useState<{
    inviteId: string;
    targetFamilyId: string;
  } | null>(null);

  async function handleAccept(inviteId: string) {
    setActingInvite(inviteId);
    try {
      await acceptInvite(inviteId);
      showToast("Joined family!", "success");
      setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId));
      loadMembers();
    } catch (err) {
      if (err instanceof NeedsMigrationDecisionError) {
        setMigrationDialog({ inviteId, targetFamilyId: err.targetFamilyId });
      } else {
        showToast(err instanceof Error ? err.message : "Failed to accept invite", "error");
      }
    } finally {
      setActingInvite(null);
    }
  }

  async function handleDecline(inviteId: string) {
    setActingInvite(inviteId);
    try {
      await declineInvite(inviteId);
      showToast("Invite declined", "success");
      setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to decline invite", "error");
    } finally {
      setActingInvite(null);
    }
  }

  // ── Leave family ───────────────────────────────────────────────────────────
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);

  async function handleLeaveConfirm() {
    setLeaveConfirmOpen(false);
    setLeaveLoading(true);
    try {
      await leaveFamily(false);
      showToast("Left family", "success");
      setMembers([]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to leave family", "error");
    } finally {
      setLeaveLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasMembersData = !membersLoading && members.length > 0;
  const memberCount = members.length;

  return (
    <div>
      {/* ── Members list ── */}
      <div
        style={{
          padding: "var(--space-3) var(--space-4) var(--space-1)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-caption)",
          color: "var(--color-text-muted)",
        }}
      >
        {membersLoading
          ? "Loading members…"
          : hasMembersData
            ? `Family (${memberCount} member${memberCount !== 1 ? "s" : ""})`
            : "Family (1 member)"}
      </div>

      {!membersLoading &&
        members.map((member) => (
          <div
            key={member.userId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: "52px",
              padding: "0 var(--space-4)",
              borderBottom: "1px solid var(--color-border)",
              gap: "var(--space-3)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <RowLabel>{member.displayName || member.email}</RowLabel>
              {member.displayName && <RowSub>{member.email}</RowSub>}
            </div>

            {member.isSelf ? (
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-caption)",
                  color: "var(--color-text-disabled)",
                  flexShrink: 0,
                }}
              >
                You
              </span>
            ) : (
              <ActionButton
                label={removingMember === member.userId ? "Removing…" : "Remove"}
                disabled={removingMember === member.userId}
                variant="danger"
                onClick={() => handleRemoveMember(member.userId)}
              />
            )}
          </div>
        ))}

      {/* ── Invite input ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <input
          type="email"
          placeholder="Invite by email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSendInvite();
          }}
          disabled={inviteSending}
          style={{
            flex: 1,
            minHeight: "40px",
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-btn)",
            padding: "0 var(--space-3)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text)",
            outline: "none",
          }}
        />
        <ActionButton
          label={inviteSending ? "Sending…" : "Send"}
          disabled={inviteSending || inviteEmail.trim() === ""}
          variant="primary"
          onClick={handleSendInvite}
        />
      </div>

      {/* ── Incoming invites ── */}
      {!invitesLoading && invites.length > 0 && (
        <div
          style={{
            padding: "var(--space-3) var(--space-4) var(--space-1)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-muted)",
          }}
        >
          Pending invites
        </div>
      )}

      {!invitesLoading &&
        invites.map((invite) => (
          <div
            key={invite.inviteId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: "52px",
              padding: "0 var(--space-4)",
              borderBottom: "1px solid var(--color-border)",
              gap: "var(--space-3)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <RowLabel>{invite.inviterDisplayName || invite.inviterEmail}</RowLabel>
              {invite.inviterDisplayName && <RowSub>{invite.inviterEmail}</RowSub>}
            </div>

            <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
              <ActionButton
                label={actingInvite === invite.inviteId ? "…" : "Accept"}
                disabled={actingInvite === invite.inviteId}
                variant="primary"
                onClick={() => handleAccept(invite.inviteId)}
              />
              <ActionButton
                label={actingInvite === invite.inviteId ? "…" : "Decline"}
                disabled={actingInvite === invite.inviteId}
                variant="danger"
                onClick={() => handleDecline(invite.inviteId)}
              />
            </div>
          </div>
        ))}

      {/* ── Leave family ── */}
      <button
        onClick={() => setLeaveConfirmOpen(true)}
        disabled={leaveLoading}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          width: "100%",
          padding: "0 var(--space-4)",
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          cursor: leaveLoading ? "not-allowed" : "pointer",
          opacity: leaveLoading ? 0.6 : 1,
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
            color: "var(--color-expense)",
          }}
        >
          {leaveLoading ? "Leaving…" : "Leave family"}
        </span>
      </button>

      {/* Take a copy — Phase 13 stub */}
      <ComingSoonStub>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: "52px",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
            }}
          >
            Take a copy first
          </span>
        </div>
      </ComingSoonStub>

      {/* Leave confirm dialog */}
      <ConfirmDialog
        isOpen={leaveConfirmOpen}
        title="Leave family"
        body="You will lose access to shared records. Your own records will remain on the server until you rejoin or delete your account."
        confirmLabel="Leave"
        onConfirm={handleLeaveConfirm}
        onCancel={() => setLeaveConfirmOpen(false)}
        variant="destructive"
      />

      {/* Migration decision dialog */}
      <MigrationDialog
        isOpen={migrationDialog !== null}
        inviteId={migrationDialog?.inviteId ?? ""}
        targetFamilyId={migrationDialog?.targetFamilyId ?? ""}
        onClose={() => setMigrationDialog(null)}
        onDone={() => {
          setMigrationDialog(null);
          loadInvites();
          loadMembers();
        }}
      />
    </div>
  );
}
