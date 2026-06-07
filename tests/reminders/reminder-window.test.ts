import { describe, it, expect } from 'vitest';
import { isReminderDue, daysUntil, buildReminderIndex } from '@/lib/reminders/reminder-window';
import type { Subscription } from '@/lib/types';

describe('daysUntil', () => {
  it('returns 0 for same day', () => {
    expect(daysUntil('2026-06-06', new Date('2026-06-06T12:00:00Z'))).toBe(0);
  });
  it('returns positive for future', () => {
    expect(daysUntil('2026-06-09', new Date('2026-06-06T00:00:00Z'))).toBe(3);
  });
  it('returns negative for past', () => {
    expect(daysUntil('2026-06-04', new Date('2026-06-06T00:00:00Z'))).toBe(-2);
  });
});

describe('isReminderDue', () => {
  const today = new Date('2026-06-06T08:00:00Z');
  it('is due when within lead window', () => {
    expect(isReminderDue({ next_renewal: '2026-06-09', lead_days: 3 }, today)).toBe(true);
  });
  it('is due exactly at the lead boundary', () => {
    expect(isReminderDue({ next_renewal: '2026-06-09', lead_days: 3 }, today)).toBe(true);
  });
  it('is NOT due before the window opens', () => {
    expect(isReminderDue({ next_renewal: '2026-06-20', lead_days: 3 }, today)).toBe(false);
  });
  it('is due on renewal day (0 days left)', () => {
    expect(isReminderDue({ next_renewal: '2026-06-06', lead_days: 3 }, today)).toBe(true);
  });
  it('is NOT due after renewal passed', () => {
    expect(isReminderDue({ next_renewal: '2026-06-01', lead_days: 3 }, today)).toBe(false);
  });
});

describe('buildReminderIndex', () => {
  const subs: Subscription[] = [
    { id: '1', serviceName: 'Netflix', amount: 15.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active' } as Subscription,
    { id: '2', serviceName: 'Spotify', amount: 9.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-07-05', status: 'paused' } as Subscription,
  ];
  it('maps only active subs to minimal index entries (no amounts)', () => {
    const idx = buildReminderIndex(subs, 3);
    expect(idx).toEqual([
      { service_label: 'Netflix', next_renewal: '2026-07-01', lead_days: 3 },
    ]);
  });
  it('never includes amount/currency/sensitive fields', () => {
    const idx = buildReminderIndex(subs, 5);
    for (const e of idx) {
      expect(Object.keys(e).sort()).toEqual(['lead_days', 'next_renewal', 'service_label']);
    }
  });
});
