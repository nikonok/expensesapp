import { create } from 'zustand';
import { db } from '../db/database';

interface SettingsStore {
  mainCurrency: string;
  language: string;
  startupScreen: string;
  notificationEnabled: boolean;
  notificationTime: string;
  lastUsedAccountId: number | null;
  autoBackupIntervalHours: number | null;
  lastAutoBackupAt: string | null;
  hasCompletedOnboarding: boolean;
  isLoaded: boolean;

  load: () => Promise<void>;
  update: (key: string, value: unknown) => Promise<void>;
}

const VALID_SETTING_KEYS = new Set([
  'mainCurrency',
  'language',
  'startupScreen',
  'notificationEnabled',
  'notificationTime',
  'lastUsedAccountId',
  'autoBackupIntervalHours',
  'lastAutoBackupAt',
  'hasCompletedOnboarding',
]);

const DEFAULTS: Omit<SettingsStore, 'load' | 'update' | 'isLoaded'> = {
  mainCurrency: 'USD',
  language: 'en',
  startupScreen: 'transactions',
  notificationEnabled: false,
  notificationTime: '20:00',
  lastUsedAccountId: null,
  autoBackupIntervalHours: null,
  lastAutoBackupAt: null,
  hasCompletedOnboarding: false,
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  isLoaded: false,

  load: async () => {
    if (get().isLoaded) return;
    const rows = await db.settings.toArray();
    const map: Record<string, unknown> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    const VALID_STARTUP_SCREENS = new Set(['accounts', 'categories', 'transactions', 'budget', 'overview']);

    set({
      mainCurrency: (map['mainCurrency'] as string) ?? DEFAULTS.mainCurrency,
      language: (map['language'] as string) ?? DEFAULTS.language,
      startupScreen: VALID_STARTUP_SCREENS.has(map['startupScreen'] as string)
        ? (map['startupScreen'] as string)
        : DEFAULTS.startupScreen,
      notificationEnabled:
        (map['notificationEnabled'] as boolean) ?? DEFAULTS.notificationEnabled,
      notificationTime: (map['notificationTime'] as string) ?? DEFAULTS.notificationTime,
      lastUsedAccountId:
        (map['lastUsedAccountId'] as number | null) ?? DEFAULTS.lastUsedAccountId,
      autoBackupIntervalHours:
        (map['autoBackupIntervalHours'] as number | null) ?? DEFAULTS.autoBackupIntervalHours,
      lastAutoBackupAt:
        (map['lastAutoBackupAt'] as string | null) ?? DEFAULTS.lastAutoBackupAt,
      hasCompletedOnboarding:
        (map['hasCompletedOnboarding'] as boolean) ?? DEFAULTS.hasCompletedOnboarding,
      isLoaded: true,
    });
  },

  update: async (key: string, value: unknown) => {
    if (!VALID_SETTING_KEYS.has(key)) {
      console.error('Unknown setting key:', key);
      return;
    }
    const prev = (get() as unknown as Record<string, unknown>)[key];
    if (prev === value) return;
    set({ [key]: value } as Partial<SettingsStore>);
    try {
      await db.settings.put({ key, value });
    } catch (err) {
      console.error('Failed to persist setting:', key, err);
      set({ [key]: prev } as Partial<SettingsStore>);
      throw err;
    }
  },
}));
