import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSyncEnabled, createSyncService } from '@/lib/sync/sync-controller';

describe('sync-controller gating', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('isSyncEnabled is false when flag is not "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', '');
    expect(isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled is true only when flag === "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', 'true');
    expect(isSyncEnabled()).toBe(true);
  });

  it('createSyncService returns null when sync disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', '');
    expect(await createSyncService()).toBeNull();
  });
});
