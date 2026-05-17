const isWriteMethod = (m: string) => /^(POST|PUT|PATCH|DELETE)$/i.test(m);

export interface ApiError extends Error {
  status: number;
  problem?: { type: string; title: string; status: number; detail?: string };
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
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
