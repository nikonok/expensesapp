// Typed HTTP wrappers for the /v1/notifications endpoints — Phase 9g.
//
// Public API:
//   getNotificationSettings()   — GET /api/v1/notifications/settings
//   patchNotificationSettings() — PATCH /api/v1/notifications/settings
//   dismissNotification()       — POST /api/v1/notifications/dismiss

import { apiFetch } from "@/services/auth/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotificationSettings {
  /** HH:MM — daily reminder time in the user's local timezone. */
  dailyReminderTime: string;
  /** Whether to send a daily reminder push. */
  dailyReminderEnabled: boolean;
  /** Whether to send a push when the user has not logged anything for a day. */
  missedDayEnabled: boolean;
  /** Whether to send a family digest push. */
  familyDigestEnabled: boolean;
  /** Quiet hours start in HH:MM (null = no quiet hours). */
  quietHoursStart: string | null;
  /** Quiet hours end in HH:MM. */
  quietHoursEnd: string | null;
}

export type PatchNotificationSettingsBody = Partial<NotificationSettings>;

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications/settings
 * Returns the current notification preferences for the signed-in user.
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  return apiFetch<NotificationSettings>("/api/v1/notifications/settings");
}

/**
 * PATCH /api/v1/notifications/settings
 * Updates one or more notification preference fields.
 */
export async function patchNotificationSettings(
  body: PatchNotificationSettingsBody,
): Promise<NotificationSettings> {
  return apiFetch<NotificationSettings>("/api/v1/notifications/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/v1/notifications/dismiss
 * Marks a notification as dismissed so other devices can clear it.
 */
export async function dismissNotification(notificationId: string): Promise<void> {
  await apiFetch<void>("/api/v1/notifications/dismiss", {
    method: "POST",
    body: JSON.stringify({ notificationId }),
  });
}
