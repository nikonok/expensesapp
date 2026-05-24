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

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SETTINGS_FIXTURE = {
  dailyReminderTime: "20:00",
  dailyReminderEnabled: true,
  missedDayEnabled: false,
  familyDigestEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
};

// ── getNotificationSettings ────────────────────────────────────────────────────

describe("getNotificationSettings", () => {
  it("GETs /api/v1/notifications/settings and returns settings", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(SETTINGS_FIXTURE));
    const { getNotificationSettings } = await import("./client");

    const result = await getNotificationSettings();

    expect(result.dailyReminderTime).toBe("20:00");
    expect(result.dailyReminderEnabled).toBe(true);
    expect(result.quietHoursStart).toBeNull();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/notifications/settings");
    expect((init as RequestInit).method ?? "GET").toBe("GET");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Unauthorized" }, 401));
    const { getNotificationSettings } = await import("./client");

    await expect(getNotificationSettings()).rejects.toThrow();
  });
});

// ── patchNotificationSettings ──────────────────────────────────────────────────

describe("patchNotificationSettings", () => {
  it("PATCHes the settings endpoint with the provided fields", async () => {
    const updated = { ...SETTINGS_FIXTURE, dailyReminderEnabled: false };
    mockFetch.mockResolvedValueOnce(okResponse(updated));
    const { patchNotificationSettings } = await import("./client");

    const result = await patchNotificationSettings({ dailyReminderEnabled: false });

    expect(result.dailyReminderEnabled).toBe(false);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/notifications/settings");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string) as {
      dailyReminderEnabled: boolean;
    };
    expect(body.dailyReminderEnabled).toBe(false);
  });

  it("can patch quiet hours", async () => {
    const updated = { ...SETTINGS_FIXTURE, quietHoursStart: "22:00", quietHoursEnd: "08:00" };
    mockFetch.mockResolvedValueOnce(okResponse(updated));
    const { patchNotificationSettings } = await import("./client");

    const result = await patchNotificationSettings({
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    });

    expect(result.quietHoursStart).toBe("22:00");
    expect(result.quietHoursEnd).toBe("08:00");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Bad Request" }, 400));
    const { patchNotificationSettings } = await import("./client");

    await expect(patchNotificationSettings({ dailyReminderEnabled: true })).rejects.toThrow();
  });
});

// ── dismissNotification ────────────────────────────────────────────────────────

describe("dismissNotification", () => {
  it("POSTs notificationId to /api/v1/notifications/dismiss", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { dismissNotification } = await import("./client");

    await dismissNotification("notif-abc-123");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/notifications/dismiss");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as { notificationId: string };
    expect(body.notificationId).toBe("notif-abc-123");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ title: "Not Found" }, 404));
    const { dismissNotification } = await import("./client");

    await expect(dismissNotification("notif-bad")).rejects.toThrow();
  });
});
