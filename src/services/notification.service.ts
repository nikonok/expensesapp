class NotificationService {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  scheduleDailyReminder(time: string): void {
    const [h, m] = time.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target.getTime() - now.getTime();

    clearTimeout(this.timeoutId ?? undefined);
    this.timeoutId = setTimeout(() => {
      this.sendNotification('Expenses', 'Time to log your expenses!');
      this.scheduleDailyReminder(time);
    }, delay);
  }

  cancelDailyReminder(): void {
    clearTimeout(this.timeoutId ?? undefined);
    this.timeoutId = null;
  }

  sendNotification(title: string, body?: string): void {
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body, icon: '/icons/icon-192.png' });
  }

  async requestPermission(): Promise<boolean> {
    const result = await Notification.requestPermission();
    return result === 'granted';
  }
}

export const notificationService = new NotificationService();
export const { scheduleDailyReminder, cancelDailyReminder, sendNotification, requestPermission } =
  Object.fromEntries(
    ['scheduleDailyReminder', 'cancelDailyReminder', 'sendNotification', 'requestPermission'].map(
      (k) => [k, notificationService[k as keyof NotificationService].bind(notificationService)],
    ),
  ) as {
    scheduleDailyReminder: (time: string) => void;
    cancelDailyReminder: () => void;
    sendNotification: (title: string, body?: string) => void;
    requestPermission: () => Promise<boolean>;
  };
