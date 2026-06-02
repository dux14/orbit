import { repository } from '@/lib/db/repository';
import type { FxRatesCache } from '@/lib/types';

const TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export async function getFxRates(base: string): Promise<FxRatesCache> {
  const cached = await repository.getFxCache();
  if (cached && cached.base === base && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) {
    return cached;
  }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    const json = await res.json();
    const fresh: FxRatesCache = {
      base,
      rates: json.rates,
      fetchedAt: new Date().toISOString(),
      manualOverrides: cached?.manualOverrides,
    };
    await repository.saveFxCache(fresh);
    return fresh;
  } catch {
    if (cached) return cached; // stale-but-usable fallback
    throw new Error('FX rates unavailable and no cache present');
  }
}

export async function setManualRate(from: string, to: string, rate: number): Promise<void> {
  const cached = (await repository.getFxCache()) ?? { base: from, rates: {}, fetchedAt: new Date().toISOString() };
  cached.manualOverrides = { ...cached.manualOverrides, [`${from}>${to}`]: rate };
  await repository.saveFxCache(cached);
}
