// Typed HTTP wrappers for the snapshots endpoints.
// Architecture Phase 8e.
//
// Public API:
//   listSnapshots()            — GET /api/v1/snapshots
//   restoreSnapshot(date, confirm) — POST /api/v1/snapshots/{date}/restore

import { apiFetch } from "@/services/auth/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  snapshotId: string;
  date: string;
  createdAt: string;
  expiresAt: string;
}

export interface RestoreSnapshotResponse {
  newCursor: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/snapshots
 * Returns the list of available snapshots (last 30 days).
 */
export async function listSnapshots(): Promise<SnapshotEntry[]> {
  const data = await apiFetch<{ snapshots: SnapshotEntry[] } | SnapshotEntry[]>(
    "/api/v1/snapshots",
  );
  if (Array.isArray(data)) return data;
  return (data as { snapshots: SnapshotEntry[] }).snapshots ?? [];
}

/**
 * POST /api/v1/snapshots/{date}/restore?confirm=true|false
 * Restores the family state to the given date snapshot.
 * Pass confirm=true to execute; confirm=false (default) is a dry-run.
 */
export async function restoreSnapshot(
  date: string,
  confirm: boolean,
): Promise<RestoreSnapshotResponse> {
  const params = new URLSearchParams({ confirm: String(confirm) });
  return apiFetch<RestoreSnapshotResponse>(
    `/api/v1/snapshots/${encodeURIComponent(date)}/restore?${params.toString()}`,
    { method: "POST" },
  );
}
