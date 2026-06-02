import { describe, it, expect } from 'vitest';
import { dueReminders } from '@/lib/services/reminders';
import type { Subscription } from '@/lib/types';

const today = new Date('2026-06-02T12:00:00Z');

function sub(id: string, date: string, status: Subscription['status'] = 'active'): Subscription {
  return {
    id,
    serviceName: id,
    category: 'misc',
    amount: 10,
    currency: 'USD',
    billingCycle: 'monthly',
    nextRenewalDate: date,
    status,
    createdAt: '',
    updatedAt: '',
  };
}

describe('dueReminders', () => {
  it('includes a sub renewing within leadDays', () => {
    const subs = [sub('netflix', '2026-06-04')]; // 2 days away, leadDays=3
    expect(dueReminders(subs, 3, today).map((s) => s.id)).toContain('netflix');
  });

  it('excludes a sub renewing outside the lead window', () => {
    const subs = [sub('spotify', '2026-06-10')]; // 8 days away, leadDays=3
    expect(dueReminders(subs, 3, today)).toHaveLength(0);
  });

  it('excludes canceled subscriptions', () => {
    const subs = [sub('hulu', '2026-06-03', 'canceled')];
    expect(dueReminders(subs, 3, today)).toHaveLength(0);
  });

  it('excludes past-due subscriptions (negative days)', () => {
    const subs = [sub('apple', '2026-05-30')]; // 3 days in the past
    expect(dueReminders(subs, 3, today)).toHaveLength(0);
  });

  it('includes sub renewing today (0 days)', () => {
    const subs = [sub('hbo', '2026-06-02')];
    expect(dueReminders(subs, 3, today).map((s) => s.id)).toContain('hbo');
  });

  it('includes sub renewing exactly at leadDays boundary', () => {
    const subs = [sub('disney', '2026-06-05')]; // exactly 3 days away
    expect(dueReminders(subs, 3, today).map((s) => s.id)).toContain('disney');
  });
});
