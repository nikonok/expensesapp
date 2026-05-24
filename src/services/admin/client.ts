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
  promoterId: string | null;
  storageUsagePct: number;
  familyMemberCount: number;
  deviceCount: number;
  hasRecoveryCode: boolean;
  deletePending: boolean;
}

export interface AdminUsersPage {
  users: AdminUser[];
  nextCursor: string | null;
}

export interface AllowlistEntry {
  email: string;
  note: string | null;
  addedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId: string | null;
  targetEmail: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

// ── Users ──────────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/users?cursor=… — paginated user list. */
export async function listUsers(cursor?: string): Promise<AdminUsersPage> {
  const url = cursor
    ? `/api/v1/admin/users?cursor=${encodeURIComponent(cursor)}`
    : "/api/v1/admin/users";
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
  const data = await apiFetch<{ entries: AllowlistEntry[] } | AllowlistEntry[]>(
    "/api/v1/admin/allowlist",
  );
  if (Array.isArray(data)) return data;
  return (data as { entries: AllowlistEntry[] }).entries ?? [];
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

/** POST /api/v1/admin/users/:id/promote — grant admin role. */
export async function promoteAdmin(userId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/users/${userId}/promote`, { method: "POST" });
}

/** POST /api/v1/admin/users/:id/demote — revoke admin role. */
export async function demoteAdmin(userId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/users/${userId}/demote`, { method: "POST" });
}

// ── Audit log ──────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/audit?cursor=… — paginated audit log. */
export async function listAuditLog(cursor?: string): Promise<AuditLogPage> {
  const url = cursor
    ? `/api/v1/admin/audit?cursor=${encodeURIComponent(cursor)}`
    : "/api/v1/admin/audit";
  return apiFetch<AuditLogPage>(url);
}

// ── Devices ────────────────────────────────────────────────────────────────────

/** DELETE /api/v1/admin/devices/:deviceId — force-revoke a device. */
export async function revokeDevice(deviceId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/devices/${deviceId}`, { method: "DELETE" });
}
