import type { BillingCycle } from '@/lib/types';

const DAYS_PER_MONTH = 365.25 / 12; // 30.4375
const DAYS_PER_YEAR = 365.25;

interface CostInput { amount: number; billingCycle: BillingCycle; customCycleDays?: number; }

function customDays(input: CostInput): number {
  if (!input.customCycleDays || input.customCycleDays <= 0) {
    throw new Error('customCycleDays required for custom billing cycle');
  }
  return input.customCycleDays;
}

export function normalizeToMonthly(input: CostInput): number {
  switch (input.billingCycle) {
    case 'monthly': return input.amount;
    case 'annual': return input.amount / 12;
    case 'custom': return input.amount * (DAYS_PER_MONTH / customDays(input));
  }
}

export function normalizeToAnnual(input: CostInput): number {
  switch (input.billingCycle) {
    case 'monthly': return input.amount * 12;
    case 'annual': return input.amount;
    case 'custom': return input.amount * (DAYS_PER_YEAR / customDays(input));
  }
}
