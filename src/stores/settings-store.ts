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

    set({
      mainCurrency: (map['mainCurrency'] as string) ?? DEFAULTS.mainCurrency,
      language: (map['language'] as string) ?? DEFAULTS.language,
      startupScreen: (map['startupScreen'] as string) ?? DEFAULTS.startupScreen,
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
    await db.settings.put({ key, value });
    set({ [key]: value } as Partial<SettingsStore>);
  },
}));
