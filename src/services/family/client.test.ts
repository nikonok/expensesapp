// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetch ─────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

function okResponse(body: unknown = {}, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createInvite", () => {
  it("POSTs inviteeEmail and returns inviteId", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ inviteId: "inv-abc" }));
    const { createInvite } = await import("./client");

    const result = await createInvite("alice@example.com");

    expect(result.inviteId).toBe("inv-abc");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/family/invites");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as { inviteeEmail: string };
    expect(body.inviteeEmail).toBe("alice@example.com");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Bad Request" }, 400));
    const { createInvite } = await import("./client");
    await expect(createInvite("bad@example.com")).rejects.toThrow();
  });
});

describe("listIncomingInvites", () => {
  it("returns the invite list", async () => {
    const invites = [
      {
        inviteId: "inv-1",
        inviterEmail: "bob@example.com",
        inviterDisplayName: "Bob",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];
    mockFetch.mockResolvedValueOnce(okResponse(invites));
    const { listIncomingInvites } = await import("./client");

    const result = await listIncomingInvites();
    expect(result).toHaveLength(1);
    expect(result[0].inviteId).toBe("inv-1");
  });
});

describe("acceptInvite", () => {
  it("POSTs to the accept endpoint on success", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { acceptInvite } = await import("./client");

    await acceptInvite("inv-123");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/family/invites/inv-123/accept");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("throws NeedsMigrationDecisionError on 409 needs-migration-decision", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(
        {
          type: "needs-migration-decision",
          title: "needs-migration-decision",
          status: 409,
          targetFamilyId: "fam-xyz",
        },
        409,
      ),
    );
    const { acceptInvite, NeedsMigrationDecisionError } = await import("./client");

    await expect(acceptInvite("inv-123")).rejects.toBeInstanceOf(NeedsMigrationDecisionError);
  });

  it("NeedsMigrationDecisionError carries targetFamilyId", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(
        {
          type: "needs-migration-decision",
          title: "needs-migration-decision",
          status: 409,
          targetFamilyId: "fam-xyz",
        },
        409,
      ),
    );
    const { acceptInvite, NeedsMigrationDecisionError } = await import("./client");

    let caughtError: unknown;
    try {
      await acceptInvite("inv-123");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(NeedsMigrationDecisionError);
    expect((caughtError as InstanceType<typeof NeedsMigrationDecisionError>).targetFamilyId).toBe(
      "fam-xyz",
    );
  });

  it("re-throws non-409 errors as-is", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Forbidden" }, 403));
    const { acceptInvite } = await import("./client");
    await expect(acceptInvite("inv-123")).rejects.toThrow("Forbidden");
  });
});

describe("declineInvite", () => {
  it("POSTs to the decline endpoint", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { declineInvite } = await import("./client");

    await declineInvite("inv-456");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/family/invites/inv-456/decline");
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("listFamilyMembers", () => {
  it("returns members list", async () => {
    const members = [
      {
        userId: "u1",
        email: "alice@example.com",
        displayName: "Alice",
        joinedAt: "2025-01-01T00:00:00Z",
        isSelf: true,
      },
    ];
    mockFetch.mockResolvedValueOnce(okResponse(members));
    const { listFamilyMembers } = await import("./client");

    const result = await listFamilyMembers();
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe("u1");
  });

  it("returns empty array on 404 (solo user)", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Not Found" }, 404));
    const { listFamilyMembers } = await import("./client");

    const result = await listFamilyMembers();
    expect(result).toEqual([]);
  });
});

describe("leaveFamily", () => {
  it("POSTs with takeCopy=false", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { leaveFamily } = await import("./client");

    await leaveFamily(false);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/family/leave");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as { takeCopy: boolean };
    expect(body.takeCopy).toBe(false);
  });
});

describe("removeMember", () => {
  it("POSTs to the remove endpoint", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { removeMember } = await import("./client");

    await removeMember("user-999");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/family/members/user-999/remove");
    expect((init as RequestInit).method).toBe("POST");
  });
});
