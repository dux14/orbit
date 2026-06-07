import type { Subscription } from '@/lib/types';

export interface ReminderIndexEntry {
  service_label: string;
  next_renewal: string; // YYYY-MM-DD
  lead_days: number;
}

/** Whole-day difference between an ISO date (YYYY-MM-DD) and a reference instant, in UTC. */
export function daysUntil(isoDate: string, now: Date): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const ref = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - ref) / 86_400_000);
}

/** Due when the renewal is within [0, lead_days] days from now (inclusive of renewal day). */
export function isReminderDue(
  r: { next_renewal: string; lead_days: number },
  now: Date,
): boolean {
  const left = daysUntil(r.next_renewal, now);
  return left >= 0 && left <= r.lead_days;
}

/** Derive the MINIMAL plaintext index from the decrypted vault. Only active subs. No amounts/cards/emails. */
export function buildReminderIndex(subs: Subscription[], leadDays: number): ReminderIndexEntry[] {
  return subs
    .filter((s) => s.status === 'active' && !!s.nextRenewalDate)
    .map((s) => ({
      service_label: s.serviceName,
      next_renewal: s.nextRenewalDate,
      lead_days: leadDays,
    }));
}
