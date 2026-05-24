// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetch ─────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

function okResponse(body: unknown = {}, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function noContentResponse() {
  return new Response(null, { status: 204 });
}

function errorResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listUsers", () => {
  it("GETs /api/v1/admin/users without cursor", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ users: [], nextCursor: null }));
    const { listUsers } = await import("./client");

    const result = await listUsers();

    expect(result.users).toEqual([]);
    expect(result.nextCursor).toBeNull();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/users");
  });

  it("GETs with cursor query param when provided", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ users: [], nextCursor: null }));
    const { listUsers } = await import("./client");

    await listUsers("abc123");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/users?cursor=abc123");
  });

  it("returns user list from response", async () => {
    const users = [
      {
        id: "u1",
        email: "alice@example.com",
        displayName: "Alice",
        lastSignInAt: "2025-01-01T00:00:00Z",
        suspendedAt: null,
        isAdmin: false,
        promoterId: null,
        storageUsagePct: 12,
        familyMemberCount: 1,
        deviceCount: 2,
        hasRecoveryCode: true,
        deletePending: false,
      },
    ];
    mockFetch.mockResolvedValueOnce(okResponse({ users, nextCursor: "tok1" }));
    const { listUsers } = await import("./client");

    const result = await listUsers();
    expect(result.users).toHaveLength(1);
    expect(result.users[0].email).toBe("alice@example.com");
    expect(result.nextCursor).toBe("tok1");
  });
});

describe("suspendUser", () => {
  it("POSTs to suspend endpoint", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { suspendUser } = await import("./client");

    await suspendUser("user-1");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/users/user-1/suspend");
    expect(init.method).toBe("POST");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Forbidden" }, 403));
    const { suspendUser } = await import("./client");
    await expect(suspendUser("user-1")).rejects.toThrow();
  });
});

describe("unsuspendUser", () => {
  it("POSTs to unsuspend endpoint", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { unsuspendUser } = await import("./client");

    await unsuspendUser("user-1");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/users/user-1/unsuspend");
    expect(init.method).toBe("POST");
  });
});

describe("listAllowlist", () => {
  it("returns entries from { entries: [...] } response shape", async () => {
    const entries = [{ email: "bob@example.com", note: "tester", addedAt: "2025-01-01T00:00:00Z" }];
    mockFetch.mockResolvedValueOnce(okResponse({ entries }));
    const { listAllowlist } = await import("./client");

    const result = await listAllowlist();
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("bob@example.com");
  });

  it("returns entries from plain array response shape", async () => {
    const entries = [{ email: "carol@example.com", note: null, addedAt: "2025-01-02T00:00:00Z" }];
    mockFetch.mockResolvedValueOnce(okResponse(entries));
    const { listAllowlist } = await import("./client");

    const result = await listAllowlist();
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("carol@example.com");
  });
});

describe("addAllowlist", () => {
  it("POSTs email and note to allowlist", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { addAllowlist } = await import("./client");

    await addAllowlist("dave@example.com", "beta tester");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/allowlist");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { email: string; note: string | null };
    expect(body.email).toBe("dave@example.com");
    expect(body.note).toBe("beta tester");
  });

  it("sends null note when omitted", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { addAllowlist } = await import("./client");

    await addAllowlist("eve@example.com");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { email: string; note: string | null };
    expect(body.note).toBeNull();
  });
});

describe("removeAllowlist", () => {
  it("DELETEs the allowlist entry by email", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { removeAllowlist } = await import("./client");

    await removeAllowlist("frank@example.com");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/allowlist/frank%40example.com");
    expect(init.method).toBe("DELETE");
  });
});

describe("promoteAdmin", () => {
  it("POSTs to promote endpoint", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { promoteAdmin } = await import("./client");

    await promoteAdmin("user-2");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/users/user-2/promote");
    expect(init.method).toBe("POST");
  });
});

describe("demoteAdmin", () => {
  it("POSTs to demote endpoint", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { demoteAdmin } = await import("./client");

    await demoteAdmin("user-2");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/users/user-2/demote");
    expect(init.method).toBe("POST");
  });
});

describe("listAuditLog", () => {
  it("GETs /api/v1/admin/audit without cursor", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ entries: [], nextCursor: null }));
    const { listAuditLog } = await import("./client");

    const result = await listAuditLog();

    expect(result.entries).toEqual([]);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/audit");
  });

  it("GETs with cursor query param when provided", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ entries: [], nextCursor: null }));
    const { listAuditLog } = await import("./client");

    await listAuditLog("page2tok");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/audit?cursor=page2tok");
  });

  it("returns audit entries", async () => {
    const entries = [
      {
        id: "e1",
        actorId: "u1",
        actorEmail: "admin@example.com",
        action: "suspend_user",
        targetId: "u2",
        targetEmail: "victim@example.com",
        createdAt: "2025-01-01T12:00:00Z",
      },
    ];
    mockFetch.mockResolvedValueOnce(okResponse({ entries, nextCursor: null }));
    const { listAuditLog } = await import("./client");

    const result = await listAuditLog();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].action).toBe("suspend_user");
  });
});

describe("revokeDevice", () => {
  it("DELETEs the device", async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const { revokeDevice } = await import("./client");

    await revokeDevice("dev-abc");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/devices/dev-abc");
    expect(init.method).toBe("DELETE");
  });
});
