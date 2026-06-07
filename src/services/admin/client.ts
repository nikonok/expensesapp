// Admin HTTP client (Phase 10e).
//
// Typed wrappers for all admin endpoints. All calls use apiFetch which handles
// auth cookies and JSON serialisation.

import { apiFetch } from "@/services/auth/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  lastSignInAt: string | null;
  suspendedAt: string | null;
  isAdmin: boolean;
  isRoot: boolean;
  promoterId: string | null;
  storageUsagePct: number;
  familyMemberCount: number;
  deviceCount: number;
  hasRecoveryCode: boolean;
  deletePending: boolean;
}

export interface AdminUsersPage {
  items: AdminUser[];
  limit: number;
  offset: number;
}

export interface AllowlistEntry {
  email: string;
  note: string | null;
  addedAt: string;
  /** User id of the admin who added this entry (B8). */
  addedBy: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  /** Free-form JSON describing the event (B8). */
  detailJson: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

// ── Users ──────────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/users?offset=…&limit=… — paginated user list. */
export async function listUsers(offset?: number, limit?: number): Promise<AdminUsersPage> {
  const params = new URLSearchParams();
  if (offset !== undefined && offset > 0) params.set("offset", String(offset));
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  const url = qs ? `/api/v1/admin/users?${qs}` : "/api/v1/admin/users";
  return apiFetch<AdminUsersPage>(url);
}

/** POST /api/v1/admin/users/:id/suspend — suspend a user. */
export async function suspendUser(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/users/${id}/suspend`, { method: "POST" });
}

/** POST /api/v1/admin/users/:id/unsuspend — unsuspend a user. */
export async function unsuspendUser(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/users/${id}/unsuspend`, { method: "POST" });
}

// ── Allowlist ──────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/allowlist — list allowlist entries. */
export async function listAllowlist(): Promise<AllowlistEntry[]> {
  const data = await apiFetch<{ items: AllowlistEntry[] } | AllowlistEntry[]>(
    "/api/v1/admin/allowlist",
  );
  if (Array.isArray(data)) return data;
  return (data as { items: AllowlistEntry[] }).items ?? [];
}

/** POST /api/v1/admin/allowlist — add an email to the allowlist. */
export async function addAllowlist(email: string, note?: string): Promise<void> {
  await apiFetch<void>("/api/v1/admin/allowlist", {
    method: "POST",
    body: JSON.stringify({ email, note: note ?? null }),
  });
}

/** DELETE /api/v1/admin/allowlist/:email — remove an email from the allowlist. */
export async function removeAllowlist(email: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/allowlist/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}

// ── Admin role management ──────────────────────────────────────────────────────

/** POST /api/v1/admin/admins/:id/promote — grant admin role. */
export async function promoteAdmin(userId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/admins/${userId}/promote`, { method: "POST" });
}

/** POST /api/v1/admin/admins/:id/demote — revoke admin role. */
export async function demoteAdmin(userId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/admins/${userId}/demote`, { method: "POST" });
}

// ── Audit log ──────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/audit?cursor=… — paginated audit log. */
export async function listAuditLog(cursor?: string): Promise<AuditLogPage> {
  const url = cursor
    ? `/api/v1/admin/audit?cursor=${encodeURIComponent(cursor)}`
    : "/api/v1/admin/audit";
  const raw = await apiFetch<{ items: AuditLogEntry[]; nextCursor: string | null }>(url);
  return { items: raw.items, nextCursor: raw.nextCursor };
}

// ── Devices ────────────────────────────────────────────────────────────────────

/** POST /api/v1/admin/devices/:deviceId/revoke — force-revoke a device. */
export async function revokeDevice(deviceId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/devices/${deviceId}/revoke`, { method: "POST" });
}
