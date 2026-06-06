// tests/sync/repository-sync-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { repository } from '@/lib/db/repository';
import { db } from '@/lib/db/database';

describe('repository sync state', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('returns undefined when no sync state stored', async () => {
    expect(await repository.getSyncState()).toBeUndefined();
  });

  it('persists and reads back local vault ref', async () => {
    const ref = { version: 4, updatedAt: '2026-06-06T10:00:00.000Z' };
    await repository.saveSyncState(ref);
    expect(await repository.getSyncState()).toEqual(ref);
  });

  it('overwrites previous sync state', async () => {
    await repository.saveSyncState({ version: 1, updatedAt: '2026-06-06T09:00:00.000Z' });
    await repository.saveSyncState({ version: 2, updatedAt: '2026-06-06T09:30:00.000Z' });
    expect((await repository.getSyncState())?.version).toBe(2);
  });
});
