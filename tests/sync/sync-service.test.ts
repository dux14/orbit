// tests/sync/sync-service.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '@/lib/sync/sync-service';
import { syncStore } from '@/lib/store/sync-store';
import type { RemoteVault } from '@/lib/sync/types';

function makeDeps(over: Partial<{
  local: { meta: string; blob: string; version: number; updatedAt: string };
  remote: RemoteVault | null;
  pushResult: RemoteVault;
}> = {}) {
  const local = over.local ?? { meta: 'M', blob: 'B', version: 1, updatedAt: '2026-06-06T10:00:00.000Z' };
  const remote = over.remote ?? null;
  const pushResult = over.pushResult ?? { encryptedMeta: 'M', encryptedBlob: 'B', version: 2, updatedAt: '2026-06-06T10:01:00.000Z' };

  const repo = {
    pullVault: vi.fn().mockResolvedValue(remote),
    pushVault: vi.fn().mockResolvedValue(pushResult),
  };
  const readLocal = vi.fn().mockResolvedValue(local);
  const applyRemote = vi.fn().mockResolvedValue(undefined);
  const saveSyncState = vi.fn().mockResolvedValue(undefined);
  return { repo, readLocal, applyRemote, saveSyncState };
}

describe('SyncService.reconcileNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncStore.getState().reset();
  });

  it('pushes when there is no remote row (initial)', async () => {
    const d = makeDeps({ remote: null });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(d.repo.pushVault).toHaveBeenCalledWith('M', 'B', 1);
    expect(d.applyRemote).not.toHaveBeenCalled();
    expect(d.saveSyncState).toHaveBeenCalledWith({ version: 2, updatedAt: '2026-06-06T10:01:00.000Z' });
    expect(syncStore.getState().status).toBe('idle');
    expect(syncStore.getState().lastSyncedAt).not.toBeNull();
  });

  it('pulls and applies remote when remote is ahead', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:05:00.000Z' };
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote,
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(d.applyRemote).toHaveBeenCalledWith(remote);
    expect(d.repo.pushVault).not.toHaveBeenCalled();
    expect(d.saveSyncState).toHaveBeenCalledWith({ version: 5, updatedAt: '2026-06-06T10:05:00.000Z' });
  });

  it('raises conflict (sets store) when both diverged', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' };
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: '2026-06-06T10:07:00.000Z' },
      remote,
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(syncStore.getState().status).toBe('conflict');
    expect(syncStore.getState().conflict?.remote).toEqual(remote);
    expect(d.repo.pushVault).not.toHaveBeenCalled();
    expect(d.applyRemote).not.toHaveBeenCalled();
  });

  it('noop when up to date', async () => {
    const ts = '2026-06-06T10:00:00.000Z';
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: ts },
      remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 3, updatedAt: ts },
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(d.repo.pushVault).not.toHaveBeenCalled();
    expect(d.applyRemote).not.toHaveBeenCalled();
  });

  it('sets error status when the repo throws (non-conflict)', async () => {
    const d = makeDeps({ remote: null });
    d.repo.pushVault.mockRejectedValueOnce(new Error('network down'));
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(syncStore.getState().status).toBe('error');
  });

  it('resolveConflictKeepLocal pushes local with remote version as expected', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' };
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: '2026-06-06T10:07:00.000Z' },
      remote,
      pushResult: { encryptedMeta: 'M', encryptedBlob: 'B', version: 6, updatedAt: '2026-06-06T10:08:00.000Z' },
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.resolveConflictKeepLocal(remote);
    expect(d.repo.pushVault).toHaveBeenCalledWith('M', 'B', 5);
    expect(syncStore.getState().conflict).toBeNull();
  });

  it('resolveConflictUseRemote applies remote and clears conflict', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' };
    const d = makeDeps({ remote });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.resolveConflictUseRemote(remote);
    expect(d.applyRemote).toHaveBeenCalledWith(remote);
    expect(d.saveSyncState).toHaveBeenCalledWith({ version: 5, updatedAt: '2026-06-06T10:03:00.000Z' });
    expect(syncStore.getState().conflict).toBeNull();
  });
});

describe('SyncService concurrency & lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncStore.getState().reset();
  });

  it('reconcileNow is a no-op while another reconcile is in flight', async () => {
    const d = makeDeps({ remote: null });
    let release!: () => void;
    d.repo.pullVault.mockImplementationOnce(
      () => new Promise((res) => { release = () => res(null); }),
    );
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    const first = svc.reconcileNow();
    const second = svc.reconcileNow(); // entra mientras el primero espera el pull
    await second;
    release();
    await first;
    expect(d.repo.pullVault).toHaveBeenCalledTimes(1);
    expect(d.repo.pushVault).toHaveBeenCalledTimes(1);
  });

  it('cancelPendingPush clears a scheduled debounce push', async () => {
    vi.useFakeTimers();
    try {
      const d = makeDeps({ remote: null });
      const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
      svc.schedulePush();
      svc.cancelPendingPush();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(d.repo.pullVault).not.toHaveBeenCalled();
      expect(d.repo.pushVault).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
