import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The module exports bound methods from a singleton NotificationService instance.
// We import them fresh after each stubGlobal setup.

describe("notification.service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("scheduleDailyReminder", () => {
    it("schedules setTimeout for a future time today", async () => {
      // Fix "now" to 12:00:00 local time
      const now = new Date();
      now.setHours(12, 0, 0, 0);
      vi.setSystemTime(now);

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const { scheduleDailyReminder } = await import("./notification.service");
      scheduleDailyReminder("13:30");

      expect(setTimeoutSpy).toHaveBeenCalledOnce();
      const delay = setTimeoutSpy.mock.calls[0][1] as number;
      // Expected delay: 1.5 hours = 5400000 ms
      expect(delay).toBe(5400000);
    });

    it("schedules setTimeout for next day when the target time has already passed today", async () => {
      // Fix "now" to 14:00:00 local time
      const now = new Date();
      now.setHours(14, 0, 0, 0);
      vi.setSystemTime(now);

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      // Re-import to get a fresh module instance for this test
      const { notificationService } = await import("./notification.service");
      // Call via the instance directly to avoid stale binding issues
      notificationService.scheduleDailyReminder("13:30");

      expect(setTimeoutSpy).toHaveBeenCalled();
      const delay = setTimeoutSpy.mock.calls[0][1] as number;
      // Target is 13:30 next day. From 14:00 that is 23.5 hours = 84600000 ms
      expect(delay).toBe(84600000);
    });

    it("reschedules using clearTimeout before setting a new timer", async () => {
      const now = new Date();
      now.setHours(10, 0, 0, 0);
      vi.setSystemTime(now);

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const { notificationService } = await import("./notification.service");

      notificationService.scheduleDailyReminder("11:00");
      notificationService.scheduleDailyReminder("11:30");

      // clearTimeout should have been called twice (once on each call to cancel the previous timer)
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancelDailyReminder", () => {
    it("calls clearTimeout when a timer exists", async () => {
      const now = new Date();
      now.setHours(10, 0, 0, 0);
      vi.setSystemTime(now);

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const { notificationService } = await import("./notification.service");

      notificationService.scheduleDailyReminder("11:00");
      notificationService.cancelDailyReminder();

      // clearTimeout is called once in scheduleDailyReminder (to clear previous) and once in cancel
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("does not throw when called with no active timer", async () => {
      const { notificationService } = await import("./notification.service");
      expect(() => notificationService.cancelDailyReminder()).not.toThrow();
    });
  });

  describe("sendNotification", () => {
    it('is a no-op when Notification.permission is "denied"', async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "denied" as NotificationPermission,
        requestPermission: vi.fn(),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      notificationService.sendNotification("Test", "body");

      expect(NotificationMock).not.toHaveBeenCalled();
    });

    it('is a no-op when Notification.permission is "default"', async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn(),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      notificationService.sendNotification("Test", "body");

      expect(NotificationMock).not.toHaveBeenCalled();
    });

    it('calls new Notification() when permission is "granted"', async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "granted" as NotificationPermission,
        requestPermission: vi.fn(),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      notificationService.sendNotification("Expenses", "Time to log!");

      expect(NotificationMock).toHaveBeenCalledOnce();
      expect(NotificationMock).toHaveBeenCalledWith("Expenses", {
        body: "Time to log!",
        icon: "/icons/icon-192.png",
      });
    });

    it("passes undefined body when no body argument is provided", async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "granted" as NotificationPermission,
        requestPermission: vi.fn(),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      notificationService.sendNotification("Title only");

      expect(NotificationMock).toHaveBeenCalledWith("Title only", {
        body: undefined,
        icon: "/icons/icon-192.png",
      });
    });
  });

  describe("requestPermission", () => {
    it("resolves to true when the user grants permission", async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn().mockResolvedValue("granted"),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      const result = await notificationService.requestPermission();

      expect(result).toBe(true);
    });

    it("resolves to false when the user denies permission", async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn().mockResolvedValue("denied"),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      const result = await notificationService.requestPermission();

      expect(result).toBe(false);
    });

    it('resolves to false when the result is "default"', async () => {
      const NotificationMock = Object.assign(vi.fn(), {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn().mockResolvedValue("default"),
      });
      vi.stubGlobal("Notification", NotificationMock);

      const { notificationService } = await import("./notification.service");
      const result = await notificationService.requestPermission();

      expect(result).toBe(false);
    });
  });
});
