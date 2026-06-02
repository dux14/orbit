"use client";

import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { vaultStore } from '@/lib/store/vault-store';
import { settingsStore } from '@/lib/store/settings-store';
import { getFxRates } from '@/lib/services/fx-service';
import {
  monthlyTotal,
  annualTotal,
  breakdownByCategory,
  breakdownByPaymentMethod,
} from '@/lib/domain/totals';
import { upcomingRenewals } from '@/lib/domain/renewals';
import type { FxRatesCache, Subscription } from '@/lib/types';

export interface DashboardData {
  monthlyTotal: number;
  annualTotal: number;
  byCategory: Record<string, number>;
  byPaymentMethod: Record<string, number>;
  upcoming: Subscription[];
  fxError: string | null;
}

function safeCompute<T>(fn: () => T, fallback: T): { value: T; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { value: fallback, error: msg };
  }
}

export function useDashboard(): DashboardData {
  const subscriptions = useStore(vaultStore, (s) => s.data?.subscriptions ?? []);
  const primaryCurrency = useStore(settingsStore, (s) => s.settings.primaryCurrency);

  const [fx, setFx] = useState<FxRatesCache | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);

  // Load FX rates whenever primaryCurrency changes
  useEffect(() => {
    let cancelled = false;
    getFxRates(primaryCurrency)
      .then((rates) => {
        if (!cancelled) {
          setFx(rates);
          setFxError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setFxError(msg);
          // keep previous fx if available
        }
      });
    return () => {
      cancelled = true;
    };
  }, [primaryCurrency]);

  const derived = useMemo(() => {
    if (!fx) {
      // No FX yet — return zeros but surface fxError if set
      return {
        monthlyTotal: 0,
        annualTotal: 0,
        byCategory: {} as Record<string, number>,
        byPaymentMethod: {} as Record<string, number>,
        computeError: fxError,
      };
    }

    const mt = safeCompute(() => monthlyTotal(subscriptions, primaryCurrency, fx), 0);
    const at = safeCompute(() => annualTotal(subscriptions, primaryCurrency, fx), 0);
    const bc = safeCompute(() => breakdownByCategory(subscriptions, primaryCurrency, fx), {} as Record<string, number>);
    const bpm = safeCompute(() => breakdownByPaymentMethod(subscriptions, primaryCurrency, fx), {} as Record<string, number>);

    const computeError = mt.error ?? at.error ?? bc.error ?? bpm.error ?? null;

    return {
      monthlyTotal: mt.value,
      annualTotal: at.value,
      byCategory: bc.value,
      byPaymentMethod: bpm.value,
      computeError,
    };
  }, [subscriptions, fx, primaryCurrency, fxError]);

  const upcoming = useMemo(
    () => upcomingRenewals(subscriptions, new Date()),
    [subscriptions]
  );

  return {
    monthlyTotal: derived.monthlyTotal,
    annualTotal: derived.annualTotal,
    byCategory: derived.byCategory,
    byPaymentMethod: derived.byPaymentMethod,
    upcoming,
    fxError: derived.computeError ?? fxError,
  };
}
