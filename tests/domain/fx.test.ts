import { describe, it, expect } from 'vitest';
import { convertCurrency } from '@/lib/domain/fx';
import type { FxRatesCache } from '@/lib/types';

const cache: FxRatesCache = { base: 'USD', rates: { USD: 1, EUR: 0.9, GBP: 0.8 }, fetchedAt: '2026-06-01T00:00:00Z' };

describe('convertCurrency', () => {
  it('same currency is identity', () => {
    expect(convertCurrency(100, 'USD', 'USD', cache)).toBe(100);
  });
  it('converts from base to target', () => {
    expect(convertCurrency(100, 'USD', 'EUR', cache)).toBeCloseTo(90);
  });
  it('converts between two non-base currencies via base', () => {
    expect(convertCurrency(90, 'EUR', 'GBP', cache)).toBeCloseTo(80);
  });
  it('uses a manual override when present', () => {
    const c = { ...cache, manualOverrides: { 'USD>JPY': 150 } };
    expect(convertCurrency(2, 'USD', 'JPY', c)).toBeCloseTo(300);
  });
  it('throws when a rate is unavailable and no override', () => {
    expect(() => convertCurrency(1, 'USD', 'JPY', cache)).toThrow(/rate/i);
  });
});
