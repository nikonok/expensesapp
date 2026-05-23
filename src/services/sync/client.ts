// Typed HTTP wrappers for the sync push/pull endpoints.
// Uses the shared apiFetch from auth/client — session cookie auth, CSRF header
// on write methods, JSON error unwrapping all handled there.
// Architecture §6.2.

import { apiFetch } from "../auth/client";
import type { PushRequest, PushResponse, PullResponse } from "./types";

const PULL_DEFAULT_LIMIT = 500;

/**
 * POST /api/v1/sync/push
 * Sends up to 50 encrypted records to the server.
 * Returns accepted + conflicts arrays (server never returns 409 — always 200).
 */
export async function pushRecords(req: PushRequest): Promise<PushResponse> {
  return apiFetch<PushResponse>("/api/v1/sync/push", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * GET /api/v1/sync/pull?since=<cursor>&limit=<n>
 * Fetches records added/updated since the given cursor.
 * Omit cursor for the initial full pull.
 */
export async function pullRecords(opts: { since?: string; limit?: number }): Promise<PullResponse> {
  const params = new URLSearchParams();
  if (opts.since) params.set("since", opts.since);
  params.set("limit", String(opts.limit ?? PULL_DEFAULT_LIMIT));
  return apiFetch<PullResponse>(`/api/v1/sync/pull?${params.toString()}`);
}
