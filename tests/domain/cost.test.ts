import { describe, it, expect } from 'vitest';
import { normalizeToMonthly, normalizeToAnnual } from '@/lib/domain/cost';

describe('cost normalization', () => {
  it('monthly stays monthly', () => {
    expect(normalizeToMonthly({ amount: 10, billingCycle: 'monthly' })).toBe(10);
  });
  it('annual divides by 12 for monthly', () => {
    expect(normalizeToMonthly({ amount: 120, billingCycle: 'annual' })).toBe(10);
  });
  it('custom uses cycle days (30.4375 avg month)', () => {
    expect(normalizeToMonthly({ amount: 7, billingCycle: 'custom', customCycleDays: 7 })).toBeCloseTo(30.4375, 3);
  });
  it('monthly annualizes to x12', () => {
    expect(normalizeToAnnual({ amount: 10, billingCycle: 'monthly' })).toBe(120);
  });
  it('annual stays annual', () => {
    expect(normalizeToAnnual({ amount: 120, billingCycle: 'annual' })).toBe(120);
  });
  it('custom annualizes by 365.25 / cycleDays', () => {
    expect(normalizeToAnnual({ amount: 7, billingCycle: 'custom', customCycleDays: 7 })).toBeCloseTo(365.25, 2);
  });
  it('throws when custom lacks cycle days', () => {
    expect(() => normalizeToMonthly({ amount: 1, billingCycle: 'custom' })).toThrow();
  });
});
