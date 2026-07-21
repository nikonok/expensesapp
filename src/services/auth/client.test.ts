/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignOut = vi.fn();
let mockIsSignedIn = false;

vi.mock("./session", () => ({
  useAuthStore: {
    getState: () => ({
      isSignedIn: mockIsSignedIn,
      signOut: mockSignOut,
    }),
  },
}));

import { apiFetch } from "./client";

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { ...headers } }));
}

function setLocation(pathname: string) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, pathname, assign: vi.fn() },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSignedIn = false;
  vi.stubGlobal("fetch", vi.fn());
  setLocation("/settings");
});

describe("apiFetch 401 interceptor — redirect only when a session existed", () => {
  it("does NOT sign out or redirect a solo/never-signed-in user hitting a protected endpoint", async () => {
    mockIsSignedIn = false;
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ type: "about:blank", title: "unauthenticated", status: 401 }, 401),
    );

    await expect(apiFetch("/api/v1/account/logs")).rejects.toThrow();

    // Let the fire-and-forget handleUnauthorized() microtask settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("signs out and redirects when a real session was active", async () => {
    mockIsSignedIn = true;
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ type: "about:blank", title: "unauthenticated", status: 401 }, 401),
    );

    await expect(apiFetch("/api/v1/account/logs")).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(window.location.assign).toHaveBeenCalledWith("/onboarding");
  });

  it("never redirect-loops on /onboarding or /signin", async () => {
    mockIsSignedIn = true;
    setLocation("/signin");
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      jsonResponse({ type: "about:blank", title: "unauthenticated", status: 401 }, 401),
    );

    await expect(apiFetch("/api/v1/account/logs")).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
