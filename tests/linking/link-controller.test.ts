// tests/linking/link-controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinkService } from '@/lib/linking/link-controller';

describe('createLinkService gating', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('returns null when sync disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', '');
    expect(await createLinkService()).toBeNull();
  });
});
