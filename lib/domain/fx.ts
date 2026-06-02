import type { FxRatesCache } from '@/lib/types';

export function convertCurrency(amount: number, from: string, to: string, cache: FxRatesCache): number {
  if (from === to) return amount;
  const override = cache.manualOverrides?.[`${from}>${to}`];
  if (override !== undefined) return amount * override;
  const rFrom = cache.rates[from];
  const rTo = cache.rates[to];
  if (rFrom === undefined || rTo === undefined) {
    throw new Error(`Missing FX rate for ${from}->${to}`);
  }
  // rates are expressed per 1 unit of cache.base
  const inBase = amount / rFrom;
  return inBase * rTo;
}
