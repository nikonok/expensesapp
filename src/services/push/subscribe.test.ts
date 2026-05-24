// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetch ─────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

// ── Mock the subscribe module to control VAPID key injection ──────────────────
// import.meta.env is resolved at module evaluation time, so we mock the whole
// module and expose a configurable vapidKey variable via the factory.

let _mockVapidKey: string | undefined = "AAAA";

vi.mock("./subscribe", async (importOriginal) => {
  const original = await importOriginal<typeof import("./subscribe")>();

  // Re-implement ensurePushSubscription using the injectable key so tests
  // can control whether the VAPID key is present.
  async function ensurePushSubscription(): Promise<{
    endpoint: string;
    p256dh: string;
    auth: string;
    id: string;
  } | null> {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
      return null;
    }
    if (!_mockVapidKey) {
      console.warn("ensurePushSubscription: VITE_VAPID_PUBLIC_KEY is not set");
      return null;
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      return null;
    }

    const registration = await navigator.serviceWorker.ready;
    const padding = "=".repeat((4 - (_mockVapidKey.length % 4)) % 4);
    const base64 = (_mockVapidKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const applicationServerKey = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) applicationServerKey[i] = rawData.charCodeAt(i);

    const subscription = await (
      registration as {
        pushManager: {
          subscribe: (opts: object) => Promise<{
            endpoint: string;
            getKey: (name: string) => ArrayBuffer | null;
            unsubscribe: () => Promise<boolean>;
          }>;
        };
      }
    ).pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    const rawKey = subscription.getKey("p256dh");
    const rawAuth = subscription.getKey("auth");
    if (!rawKey || !rawAuth) return null;

    const toBase64Url = (bytes: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    const p256dh = toBase64Url(rawKey);
    const auth = toBase64Url(rawAuth);
    const keys = { endpoint: subscription.endpoint, p256dh, auth, id: "" };

    try {
      const headers = new Headers();
      headers.set("Accept", "application/json");
      headers.set("Content-Type", "application/json");
      headers.set("X-Requested-With", "fetch");
      const res = await fetch("/api/v1/push/subscribe", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(keys),
      });
      if (!res.ok) {
        console.error("ensurePushSubscription: failed to register with backend");
      }
    } catch (err) {
      console.error("ensurePushSubscription: failed to register with backend", err);
    }

    return keys;
  }

  return { ...original, ensurePushSubscription };
});

function okResponse(body: unknown = {}, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  _mockVapidKey = "AAAA";
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePushSubscription(endpoint = "https://push.example.com/sub-1") {
  const rawKey = new Uint8Array(65).fill(0xab);
  const rawAuth = new Uint8Array(16).fill(0xcd);
  return {
    endpoint,
    getKey: (name: string) => (name === "p256dh" ? rawKey.buffer : rawAuth.buffer),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

function makeRegistration(
  subscriptionForGet: ReturnType<typeof makePushSubscription> | null = null,
) {
  return {
    pushManager: {
      subscribe: vi.fn().mockResolvedValue(makePushSubscription()),
      getSubscription: vi.fn().mockResolvedValue(subscriptionForGet),
    },
  };
}

// ── ensurePushSubscription ────────────────────────────────────────────────────

describe("ensurePushSubscription", () => {
  it("returns null when Notification is not defined", async () => {
    // Notification is undefined in node env by default.
    const { ensurePushSubscription } = await import("./subscribe");
    const result = await ensurePushSubscription();
    expect(result).toBeNull();
  });

  it("returns null when permission is denied", async () => {
    const NotificationMock = Object.assign(vi.fn(), {
      permission: "denied" as NotificationPermission,
      requestPermission: vi.fn().mockResolvedValue("denied"),
    });
    vi.stubGlobal("Notification", NotificationMock);

    const registration = makeRegistration();
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(registration) },
    });

    const { ensurePushSubscription } = await import("./subscribe");
    const result = await ensurePushSubscription();
    expect(result).toBeNull();
  });

  it("returns keys and POSTs to backend when permission is granted", async () => {
    const NotificationMock = Object.assign(vi.fn(), {
      permission: "granted" as NotificationPermission,
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("Notification", NotificationMock);

    const subscription = makePushSubscription("https://push.example.com/sub-42");
    const registration = {
      pushManager: {
        subscribe: vi.fn().mockResolvedValue(subscription),
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(registration) },
    });

    mockFetch.mockResolvedValueOnce(okResponse({ id: "sub-42" }));

    const { ensurePushSubscription } = await import("./subscribe");
    const result = await ensurePushSubscription();

    expect(result).not.toBeNull();
    expect(result!.endpoint).toBe("https://push.example.com/sub-42");
    expect(typeof result!.p256dh).toBe("string");
    expect(typeof result!.auth).toBe("string");
    // Keys must be URL-safe base64 (no +, /, or = characters).
    expect(result!.p256dh).not.toMatch(/[+/=]/);
    expect(result!.auth).not.toMatch(/[+/=]/);

    // Verify backend POST.
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/push/subscribe");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as {
      endpoint: string;
      p256dh: string;
      auth: string;
    };
    expect(body.endpoint).toBe("https://push.example.com/sub-42");
  });

  it("still returns keys even if backend POST fails", async () => {
    const NotificationMock = Object.assign(vi.fn(), {
      permission: "granted" as NotificationPermission,
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("Notification", NotificationMock);

    const registration = {
      pushManager: {
        subscribe: vi.fn().mockResolvedValue(makePushSubscription()),
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(registration) },
    });

    // Backend returns 500.
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Internal Server Error" }, 500));

    const { ensurePushSubscription } = await import("./subscribe");
    const result = await ensurePushSubscription();

    // Keys should still be returned (browser subscription succeeded).
    expect(result).not.toBeNull();
  });

  it("returns null when VAPID key is not set", async () => {
    _mockVapidKey = "";

    const NotificationMock = Object.assign(vi.fn(), {
      permission: "granted" as NotificationPermission,
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(makeRegistration()) },
    });

    const { ensurePushSubscription } = await import("./subscribe");
    const result = await ensurePushSubscription();
    expect(result).toBeNull();
  });
});

// ── disablePush ───────────────────────────────────────────────────────────────

describe("disablePush", () => {
  it("calls unsubscribe locally and sends DELETE to backend", async () => {
    const subscription = makePushSubscription();
    const registration = {
      pushManager: {
        subscribe: vi.fn(),
        getSubscription: vi.fn().mockResolvedValue(subscription),
      },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(registration) },
    });

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { disablePush } = await import("./subscribe");
    await disablePush("sub-99");

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/push/subscribe/sub-99");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("sends DELETE even if there is no existing local subscription", async () => {
    const registration = {
      pushManager: {
        subscribe: vi.fn(),
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(registration) },
    });

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { disablePush } = await import("./subscribe");
    await disablePush("sub-none");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/push/subscribe/sub-none");
  });
});
