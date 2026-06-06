// tests/sync/sync-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { syncStore } from '@/lib/store/sync-store';

describe('syncStore', () => {
  beforeEach(() => syncStore.getState().reset());

  it('starts idle with no conflict', () => {
    const s = syncStore.getState();
    expect(s.status).toBe('idle');
    expect(s.conflict).toBeNull();
    expect(s.lastSyncedAt).toBeNull();
  });

  it('setStatus updates status', () => {
    syncStore.getState().setStatus('syncing');
    expect(syncStore.getState().status).toBe('syncing');
  });

  it('markSynced sets idle + lastSyncedAt and clears conflict', () => {
    syncStore.getState().setConflict({
      localUpdatedAt: '2026-06-06T10:00:00.000Z',
      remoteUpdatedAt: '2026-06-06T10:05:00.000Z',
      remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 2, updatedAt: '2026-06-06T10:05:00.000Z' },
    });
    syncStore.getState().markSynced('2026-06-06T11:00:00.000Z');
    const s = syncStore.getState();
    expect(s.status).toBe('idle');
    expect(s.lastSyncedAt).toBe('2026-06-06T11:00:00.000Z');
    expect(s.conflict).toBeNull();
  });

  it('setConflict moves status to conflict and stores info', () => {
    const info = {
      localUpdatedAt: '2026-06-06T10:00:00.000Z',
      remoteUpdatedAt: '2026-06-06T10:05:00.000Z',
      remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 2, updatedAt: '2026-06-06T10:05:00.000Z' },
    };
    syncStore.getState().setConflict(info);
    expect(syncStore.getState().status).toBe('conflict');
    expect(syncStore.getState().conflict).toEqual(info);
  });
});
