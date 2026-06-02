import type { Subscription, FxRatesCache } from '@/lib/types';
import { normalizeToMonthly, normalizeToAnnual } from './cost';
import { convertCurrency } from './fx';

const active = (subs: Subscription[]) => subs.filter((s) => s.status !== 'canceled');

export function monthlyInPrimary(s: Subscription, primary: string, fx: FxRatesCache): number {
  const monthly = normalizeToMonthly(s);
  return convertCurrency(monthly, s.currency, primary, fx);
}

export function monthlyTotal(subs: Subscription[], primary: string, fx: FxRatesCache): number {
  return active(subs).reduce((sum, s) => sum + monthlyInPrimary(s, primary, fx), 0);
}

export function annualTotal(subs: Subscription[], primary: string, fx: FxRatesCache): number {
  return active(subs).reduce((sum, s) => sum + convertCurrency(normalizeToAnnual(s), s.currency, primary, fx), 0);
}

export function breakdownByCategory(subs: Subscription[], primary: string, fx: FxRatesCache): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of active(subs)) out[s.category] = (out[s.category] ?? 0) + monthlyInPrimary(s, primary, fx);
  return out;
}

export function breakdownByPaymentMethod(subs: Subscription[], primary: string, fx: FxRatesCache): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of active(subs)) {
    const key = s.paymentMethodId ?? 'none';
    out[key] = (out[key] ?? 0) + monthlyInPrimary(s, primary, fx);
  }
  return out;
}
