import type { Subscription } from '@/lib/types';
import { isWithinLeadTime, daysUntilRenewal } from '@/lib/domain/renewals';

// ─── Pure: which subs need a reminder ────────────────────────────────────────

export function dueReminders(
  subs: Subscription[],
  leadDays: number,
  today: Date,
): Subscription[] {
  return subs.filter(
    (s) => s.status !== 'canceled' && isWithinLeadTime(s.nextRenewalDate, today, leadDays),
  );
}

// ─── Notification API helpers (browser-only, SSR-safe) ────────────────────────

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  return Notification.requestPermission();
}

// ─── Deduplication key ────────────────────────────────────────────────────────

function reminderKey(subId: string, today: Date): string {
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  return `orbit-reminded-${subId}-${yyyy}-${mm}-${dd}`;
}

// ─── Fire notifications for due renewals, deduped per day ────────────────────

export function notifyDueRenewals(
  subs: Subscription[],
  leadDays: number,
  today: Date = new Date(),
): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  const due = dueReminders(subs, leadDays, today);
  for (const sub of due) {
    const key = reminderKey(sub.id, today);
    if (localStorage.getItem(key)) continue;

    const days = daysUntilRenewal(sub.nextRenewalDate, today);
    const body =
      days === 0
        ? `${sub.serviceName} renews today.`
        : `${sub.serviceName} renews in ${days} day${days === 1 ? '' : 's'}.`;

    new Notification('Orbit – Upcoming Renewal', { body });
    localStorage.setItem(key, '1');
  }
}
