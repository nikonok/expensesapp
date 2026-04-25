class NotificationService {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  scheduleDailyReminder(time: string): void {
    const [h, m] = time.split(":").map(Number);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      console.error("Invalid notification time:", time);
      return;
    }
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target.getTime() - now.getTime();

    clearTimeout(this.timeoutId ?? undefined);
    this.timeoutId = setTimeout(() => {
      this.sendNotification("Expenses", "Time to log your expenses!");
      this.scheduleDailyReminder(time);
    }, delay);
  }

  cancelDailyReminder(): void {
    clearTimeout(this.timeoutId ?? undefined);
    this.timeoutId = null;
  }

  sendNotification(title: string, body?: string): void {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/icons/icon-192.png" });
  }

  async requestPermission(): Promise<boolean> {
    const result = await Notification.requestPermission();
    return result === "granted";
  }
}

export const notificationService = new NotificationService();
export const scheduleDailyReminder =
  notificationService.scheduleDailyReminder.bind(notificationService);
export const cancelDailyReminder =
  notificationService.cancelDailyReminder.bind(notificationService);
export const sendNotification = notificationService.sendNotification.bind(notificationService);
export const requestPermission = notificationService.requestPermission.bind(notificationService);
