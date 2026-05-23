// Family lifecycle HTTP client (architecture §8.7–§8.9, Phase 7e).
//
// Typed wrappers around the family invite / leave / member-removal endpoints.
// All calls use apiFetch which handles auth cookies and JSON serialisation.

import { apiFetch, type ApiError } from "@/services/auth/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FamilyMember {
  userId: string;
  email: string;
  displayName: string;
  joinedAt: string;
  /** true when this row represents the currently signed-in user */
  isSelf: boolean;
}

export interface Invite {
  inviteId: string;
  inviterEmail: string;
  inviterDisplayName: string;
  createdAt: string;
}

export interface CreateInviteResponse {
  inviteId: string;
}

/**
 * Thrown (re-thrown) by acceptInvite when the server returns 409
 * needs-migration-decision: the accepter has solo data that must be resolved.
 */
export class NeedsMigrationDecisionError extends Error {
  readonly targetFamilyId: string;
  constructor(targetFamilyId: string) {
    super("needs-migration-decision");
    this.name = "NeedsMigrationDecisionError";
    this.targetFamilyId = targetFamilyId;
  }
}

// ── Invite actions ─────────────────────────────────────────────────────────────

/** POST /api/v1/family/invites — send an invite to an email address. */
export async function createInvite(inviteeEmail: string): Promise<CreateInviteResponse> {
  return apiFetch<CreateInviteResponse>("/api/v1/family/invites", {
    method: "POST",
    body: JSON.stringify({ inviteeEmail }),
  });
}

/** GET /api/v1/family/invites/incoming — list pending invites for the current user. */
export async function listIncomingInvites(): Promise<Invite[]> {
  const data = await apiFetch<{ invites: Invite[] } | Invite[]>("/api/v1/family/invites/incoming");
  // Backend returns { invites: [...] }; guard against a plain array for test mocks.
  if (Array.isArray(data)) return data;
  return (data as { invites: Invite[] }).invites ?? [];
}

/**
 * POST /api/v1/family/invites/{inviteId}/accept.
 *
 * If the server returns 409 with problem.type "needs-migration-decision",
 * throws NeedsMigrationDecisionError so the caller can show the migration dialog.
 * The targetFamilyId is extracted from the problem detail field.
 */
export async function acceptInvite(inviteId: string): Promise<void> {
  try {
    await apiFetch<void>(`/api/v1/family/invites/${inviteId}/accept`, { method: "POST" });
  } catch (err) {
    const apiErr = err as ApiError;
    if (
      apiErr.status === 409 &&
      (apiErr.problem?.type?.includes("needs-migration-decision") ||
        apiErr.problem?.detail?.includes("needs-migration-decision") ||
        apiErr.message === "needs-migration-decision")
    ) {
      const familyId = (apiErr.problem as Record<string, unknown>)?.targetFamilyId as
        | string
        | undefined;
      throw new NeedsMigrationDecisionError(familyId ?? "");
    }
    throw err;
  }
}

/** POST /api/v1/family/invites/{inviteId}/decline — decline an incoming invite. */
export async function declineInvite(inviteId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/family/invites/${inviteId}/decline`, { method: "POST" });
}

// ── Member list ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/family/members — list members of the current family.
 * Falls back to an empty array on 404 (solo user with no family yet).
 */
export async function listFamilyMembers(): Promise<FamilyMember[]> {
  try {
    return await apiFetch<FamilyMember[]>("/api/v1/family/members");
  } catch (err) {
    const apiErr = err as ApiError;
    if (apiErr.status === 404) return [];
    throw err;
  }
}

// ── Migration ────────────────────────────────────────────────────────────────

export interface SoloRecord {
  recordType: string;
  recordId: string;
  blob: string;
  updatedAtMap: Record<string, string>;
  deletedAt?: string;
  plaintextByteCount: number;
}

/** POST /api/v1/family/migrate-solo — push re-encrypted solo records. */
export async function migrateSolo(targetFamilyId: string, records: SoloRecord[]): Promise<void> {
  await apiFetch<void>("/api/v1/family/migrate-solo", {
    method: "POST",
    body: JSON.stringify({ targetFamilyId, records }),
  });
}

// ── Leave ─────────────────────────────────────────────────────────────────────

/** POST /api/v1/family/leave — soft-leave the current family. */
export async function leaveFamily(takeCopy: boolean): Promise<void> {
  await apiFetch<void>("/api/v1/family/leave", {
    method: "POST",
    body: JSON.stringify({ takeCopy }),
  });
}

// ── Remove member ─────────────────────────────────────────────────────────────

/** POST /api/v1/family/members/{userId}/remove — remove a member (admin/owner only). */
export async function removeMember(userId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/family/members/${userId}/remove`, { method: "POST" });
}
