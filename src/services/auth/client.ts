const isWriteMethod = (m: string) => /^(POST|PUT|PATCH|DELETE)$/i.test(m);

export interface ApiError extends Error {
  status: number;
  problem?: { type: string; title: string; status: number; detail?: string };
}

/**
 * B8 — global 401/429 handling.
 *
 * The auth + UI stores can't be imported eagerly at module load (would create a
 * cycle and break tests). Instead we dynamic-import them once on demand and
 * cache the lookup. A small fallback path keeps things safe in node tests.
 */
async function handleUnauthorized(): Promise<void> {
  try {
    const { useAuthStore } = await import("./session");
    const state = useAuthStore.getState();
    if (state.isSignedIn) {
      await state.signOut();
    }
    if (typeof window !== "undefined") {
      const path = window.location.pathname;
      // Avoid loops on the public sign-in / onboarding pages.
      if (path !== "/onboarding" && path !== "/signin") {
        window.location.assign("/onboarding");
      }
    }
  } catch {
    // ignore — best-effort
  }
}

async function handleRateLimited(retryAfter: number | null): Promise<void> {
  try {
    // Toast is mounted by App.tsx; if it isn't ready we just no-op.
    const mod = await import("@/components/shared/Toast");
    const message =
      retryAfter !== null && retryAfter > 0
        ? `Too many requests, retrying in ${retryAfter}s`
        : "Too many requests, slow down";
    mod.toast?.(message, "warning", 4000);
  } catch {
    // ignore — best-effort
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (isWriteMethod(method)) headers.set("X-Requested-With", "fetch");
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  if (!res.ok) {
    let problem: ApiError["problem"];
    try {
      problem = await res.json();
    } catch {}
    const err = new Error(problem?.title ?? `HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    err.problem = problem;

    // Global interceptors (B8). Fire-and-forget so callers still see the throw.
    if (res.status === 401) {
      void handleUnauthorized();
    } else if (res.status === 429) {
      const raw = res.headers.get("Retry-After");
      const retryAfter = raw !== null && raw !== "" ? Number.parseInt(raw, 10) : null;
      void handleRateLimited(Number.isFinite(retryAfter) ? retryAfter : null);
    }

    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
