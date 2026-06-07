'use client';

import * as React from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from 'zustand';
import { useT } from '@/lib/i18n/use-t';
import { settingsStore, useSettingsStore } from '@/lib/store/settings-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { vaultStore } from '@/lib/store/vault-store';
import { enablePush, disablePush, detectPushSupport } from '@/lib/push/subscribe';
import { syncReminderIndex, clearReminderIndex } from '@/lib/reminders/cloud-reminders';

// Push support never changes within a page lifetime; nothing to subscribe to.
const emptySubscribe = () => () => {};

/**
 * Opt-in cloud reminders (S10). The ONLY documented zero-knowledge exception:
 * with the toggle ON, a minimal plaintext index (service name + renewal date)
 * is mirrored server-side so push reminders work with the app closed.
 * Renders nothing when signed out or when the browser has no push support.
 */
export function CloudRemindersSection() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const enabled = useSettingsStore((s) => s.settings.cloudReminders);
  const leadDays = useSettingsStore((s) => s.settings.reminderLeadDays);
  const subscriptions = useStore(vaultStore, (s) => s.data?.subscriptions ?? []);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  // Permission prompts can hang for a long time; never set state after unmount.
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // SSR-safe support detection: false on the server, real (stable) value on the client.
  const support = React.useSyncExternalStore(
    emptySubscribe,
    () => detectPushSupport().supported,
    () => false,
  );

  if (!user || !support) return null;

  async function turnOn() {
    setBusy(true);
    setMsg(t('reminders.enabling'));
    try {
      const res = await enablePush();
      if (!mounted.current) return;
      if (!res.ok) {
        setMsg(res.reason === 'permission-denied' ? t('reminders.permission.denied') : t('settings.bioError'));
        return;
      }
      await syncReminderIndex(subscriptions, leadDays);
      if (!mounted.current) return;
      await settingsStore.getState().updateSettings({ cloudReminders: true });
      if (!mounted.current) return;
      setMsg(t('reminders.enabled'));
    } catch {
      if (mounted.current) setMsg(t('settings.bioError'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMsg(t('reminders.disabling'));
    try {
      await disablePush();
      await clearReminderIndex();
      if (!mounted.current) return;
      await settingsStore.getState().updateSettings({ cloudReminders: false });
      if (!mounted.current) return;
      setMsg(t('reminders.disabled'));
    } catch {
      if (mounted.current) setMsg(t('settings.bioError'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card px-5 py-5 flex flex-col gap-5"
      aria-labelledby="cloud-reminders-heading"
    >
      <h2 id="cloud-reminders-heading" className="font-heading text-base leading-tight text-foreground">
        {t('reminders.section.title')}
      </h2>

      {/* Honest disclosure — always visible, even when off. */}
      <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm flex flex-col gap-2">
        <p className="font-medium text-foreground">{t('reminders.disclosure.title')}</p>
        <p className="text-muted-foreground">{t('reminders.disclosure.body')}</p>
        <p className="text-muted-foreground">{t('reminders.disclosure.default')}</p>
        <p className="text-muted-foreground">{t('reminders.ios.note')}</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor="cloud-reminders-toggle" className="text-sm font-medium text-foreground">
          {t('reminders.toggle.label')}
        </label>
        <Button
          id="cloud-reminders-toggle"
          type="button"
          variant="outline"
          role="switch"
          aria-checked={enabled}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void (enabled ? turnOff() : turnOn())}
          className="h-11 min-w-[44px] gap-2 shrink-0"
        >
          <BellRing aria-hidden className="size-4" />
          {enabled ? t('reminders.toggle.on') : t('reminders.toggle.off')}
        </Button>
      </div>

      {msg && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {msg}
        </p>
      )}
    </section>
  );
}
