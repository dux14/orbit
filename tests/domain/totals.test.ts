import { describe, it, expect } from 'vitest';
import { monthlyTotal, annualTotal, breakdownByCategory, breakdownByPaymentMethod } from '@/lib/domain/totals';
import type { Subscription, FxRatesCache } from '@/lib/types';

const fx: FxRatesCache = { base: 'USD', rates: { USD: 1, EUR: 0.5 }, fetchedAt: '' };
const s = (over: Partial<Subscription>): Subscription => ({
  id: Math.random().toString(), serviceName: 'x', category: 'misc', amount: 10, currency: 'USD',
  billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active', createdAt: '', updatedAt: '', ...over,
});

describe('totals', () => {
  it('sums monthly-normalized amounts in primary currency', () => {
    const subs = [s({ amount: 10, currency: 'USD' }), s({ amount: 120, currency: 'USD', billingCycle: 'annual' })];
    expect(monthlyTotal(subs, 'USD', fx)).toBeCloseTo(20);
  });
  it('converts foreign currency into the primary currency', () => {
    expect(monthlyTotal([s({ amount: 10, currency: 'EUR' })], 'USD', fx)).toBeCloseTo(20);
  });
  it('annual total is monthly x-equivalent', () => {
    expect(annualTotal([s({ amount: 10, currency: 'USD' })], 'USD', fx)).toBeCloseTo(120);
  });
  it('excludes canceled subscriptions from totals', () => {
    expect(monthlyTotal([s({ status: 'canceled' })], 'USD', fx)).toBe(0);
  });
  it('breaks down monthly spend by category', () => {
    const subs = [s({ category: 'video', amount: 10 }), s({ category: 'music', amount: 5 }), s({ category: 'video', amount: 5 })];
    expect(breakdownByCategory(subs, 'USD', fx)).toEqual({ video: 15, music: 5 });
  });
  it('breaks down by payment method, grouping missing as "none"', () => {
    const subs = [s({ paymentMethodId: 'p1', amount: 10 }), s({ amount: 5 })];
    expect(breakdownByPaymentMethod(subs, 'USD', fx)).toEqual({ p1: 10, none: 5 });
  });
});
