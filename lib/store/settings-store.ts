import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { repository } from '@/lib/db/repository';
import type { Settings } from '@/lib/types';

const DEFAULTS: Settings = {
  primaryCurrency: 'USD',
  theme: 'system',
  locale: 'en',
  reminderLeadDays: 3,
  autoLockMinutes: 5,
  cloudReminders: false,
};

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

export const settingsStore = createStore<SettingsState>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,

  async loadSettings() {
    try {
      const stored = await repository.getSettings();
      // Merge over defaults so settings persisted before a new field existed
      // (e.g. cloudReminders, S10) still satisfy the full Settings shape.
      set({ settings: stored ? { ...DEFAULTS, ...stored } : DEFAULTS, loaded: true });
    } catch {
      set({ settings: DEFAULTS, loaded: true });
    }
  },

  async updateSettings(patch) {
    const next: Settings = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      await repository.saveSettings(next);
    } catch {
      // best-effort; state is still updated in memory
    }
  },
}));

/** React binding — use like: useSettingsStore(s => s.settings.primaryCurrency) */
export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}
