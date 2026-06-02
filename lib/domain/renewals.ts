import type { Subscription } from '@/lib/types';

const MS_PER_DAY = 86_400_000;

function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function daysUntilRenewal(nextRenewalDate: string, today: Date): number {
  const target = new Date(nextRenewalDate + 'T00:00:00Z').getTime();
  return Math.round((target - startOfDayUTC(today)) / MS_PER_DAY);
}

export function isWithinLeadTime(nextRenewalDate: string, today: Date, leadDays: number): boolean {
  const d = daysUntilRenewal(nextRenewalDate, today);
  return d >= 0 && d <= leadDays;
}

export function upcomingRenewals(subs: Subscription[], today: Date): Subscription[] {
  return subs
    .filter((s) => s.status !== 'canceled' && daysUntilRenewal(s.nextRenewalDate, today) >= 0)
    .sort((a, b) => daysUntilRenewal(a.nextRenewalDate, today) - daysUntilRenewal(b.nextRenewalDate, today));
}
