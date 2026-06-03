'use client';

import { useSettingsStore } from '@/lib/store/settings-store';
import { DICT, type DictKey } from './dict';

/**
 * useT — minimal i18n hook.
 *
 * Returns a `t(key, params?)` function that looks up the current locale's
 * string and optionally interpolates `{token}` placeholders.
 * Falls back to English if the key is missing in the active locale.
 *
 * Usage:
 *   const t = useT();
 *   <h1>{t('settings.title')}</h1>
 *   <p>{t('dashboard.renewsIn', { n: 3 })}</p>  // "renews in 3 days"
 */
export function useT(): (key: DictKey, params?: Record<string, string | number>) => string {
  const locale = useSettingsStore((s) => s.settings.locale);
  return (key: DictKey, params?: Record<string, string | number>) => {
    let str = DICT[locale]?.[key] ?? DICT['en'][key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };
}
