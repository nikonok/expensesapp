import { apiFetch } from "../auth/client";

export async function requestDeletion(): Promise<{ deleteAfter: string }> {
  return apiFetch<{ deleteAfter: string }>("/api/v1/account/request-deletion", {
    method: "POST",
  });
}

export async function cancelDeletion(): Promise<void> {
  return apiFetch<void>("/api/v1/account/cancel-deletion", {
    method: "POST",
  });
}
