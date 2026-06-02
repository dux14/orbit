import { describe, it, expect } from 'vitest';
import { daysUntilRenewal, isWithinLeadTime, upcomingRenewals } from '@/lib/domain/renewals';
import type { Subscription } from '@/lib/types';

const today = new Date('2026-06-02T12:00:00Z');
const sub = (id: string, date: string, status: Subscription['status'] = 'active'): Subscription => ({
  id, serviceName: id, category: 'misc', amount: 1, currency: 'USD', billingCycle: 'monthly',
  nextRenewalDate: date, status, createdAt: '', updatedAt: '',
});

describe('renewals', () => {
  it('counts whole days until renewal', () => {
    expect(daysUntilRenewal('2026-06-05', today)).toBe(3);
  });
  it('returns negative for past dates', () => {
    expect(daysUntilRenewal('2026-05-30', today)).toBe(-3);
  });
  it('isWithinLeadTime true when within window and not past', () => {
    expect(isWithinLeadTime('2026-06-04', today, 3)).toBe(true);
    expect(isWithinLeadTime('2026-06-10', today, 3)).toBe(false);
    expect(isWithinLeadTime('2026-05-30', today, 3)).toBe(false);
  });
  it('upcomingRenewals sorts soonest-first and excludes canceled', () => {
    const subs = [sub('b', '2026-06-10'), sub('a', '2026-06-04'), sub('c', '2026-06-01', 'canceled')];
    expect(upcomingRenewals(subs, today).map((s) => s.id)).toEqual(['a', 'b']);
  });
});
