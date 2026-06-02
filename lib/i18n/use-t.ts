'use client';

import { useSettingsStore } from '@/lib/store/settings-store';
import { DICT, type DictKey } from './dict';

/**
 * useT — minimal i18n hook.
 *
 * Returns a `t(key)` function that looks up the current locale's string.
 * Falls back to English if the key is missing in the active locale.
 *
 * Usage:
 *   const t = useT();
 *   <h1>{t('settings.title')}</h1>
 */
export function useT(): (key: DictKey) => string {
  const locale = useSettingsStore((s) => s.settings.locale);
  return (key: DictKey) => DICT[locale]?.[key] ?? DICT['en'][key] ?? key;
}
