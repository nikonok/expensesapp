import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settings-store';
import { scheduleDailyReminder } from '../../services/notification.service';
import { useToast } from '../shared/Toast';

export function NotificationSetting() {
  const { t } = useTranslation();
  const { notificationEnabled, notificationTime, update } = useSettingsStore();
  const { show } = useToast();

  async function handleToggle() {
    if (!notificationEnabled) {
      // Enabling — request permission
      if (typeof Notification !== 'undefined') {
        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        if (permission === 'denied') {
          show(
            'Notification permission denied. Please enable it in browser settings.',
            'error',
          );
          return;
        }
      }
      await update('notificationEnabled', true);
      try {
        scheduleDailyReminder(notificationTime);
      } catch {
        // stub — noop
      }
    } else {
      await update('notificationEnabled', false);
    }
  }

  async function handleTimeChange(time: string) {
    await update('notificationTime', time);
    if (notificationEnabled) {
      try {
        scheduleDailyReminder(time);
      } catch {
        // stub — noop
      }
    }
  }

  return (
    <div>
      {/* Toggle row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
          padding: '0 var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            color: 'var(--color-text)',
          }}
        >
          {t('settings.notification.label')}
        </span>
        <button
          role="switch"
          aria-checked={notificationEnabled}
          onClick={handleToggle}
          style={{
            position: 'relative',
            width: '48px',
            height: '26px',
            borderRadius: '13px',
            background: notificationEnabled ? 'var(--color-primary)' : 'var(--color-border)',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 150ms ease-out',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '3px',
              left: notificationEnabled ? '24px' : '3px',
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: 'var(--color-bg)',
              transition: 'left 150ms ease-out',
            }}
          />
        </button>
      </div>

      {/* Time picker — shown when enabled */}
      {notificationEnabled && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: '52px',
            padding: '0 var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              color: 'var(--color-text)',
            }}
          >
            {t('settings.notification.time')}
          </span>
          <input
            type="time"
            value={notificationTime}
            onChange={(e) => handleTimeChange(e.target.value)}
            style={{
              minHeight: '36px',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-input)',
              color: 'var(--color-text)',
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              colorScheme: 'dark',
            }}
          />
        </div>
      )}
    </div>
  );
}
