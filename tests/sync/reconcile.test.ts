// tests/sync/reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { reconcile } from '@/lib/sync/reconcile';
import type { RemoteVault } from '@/lib/sync/types';

const remoteAt = (version: number, updatedAt: string): RemoteVault => ({
  encryptedMeta: 'META',
  encryptedBlob: 'BLOB',
  version,
  updatedAt,
});

describe('reconcile (pure)', () => {
  it('no remote → push (initial upload)', () => {
    const r = reconcile({ local: { version: 0, updatedAt: '2026-06-06T10:00:00.000Z' }, remote: null });
    expect(r.action).toBe('push');
  });

  it('local never synced (version 0) but remote exists → pull (new device)', () => {
    const r = reconcile({
      local: { version: 0, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote: remoteAt(5, '2026-06-06T09:00:00.000Z'),
    });
    expect(r.action).toBe('pull');
  });

  it('equal versions, equal timestamps → noop', () => {
    const ts = '2026-06-06T10:00:00.000Z';
    const r = reconcile({ local: { version: 3, updatedAt: ts }, remote: remoteAt(3, ts) });
    expect(r.action).toBe('noop');
  });

  it('equal versions, local newer than remote → push (local ahead, pending mutation)', () => {
    const r = reconcile({
      local: { version: 3, updatedAt: '2026-06-06T10:05:00.000Z' },
      remote: remoteAt(3, '2026-06-06T10:00:00.000Z'),
    });
    expect(r.action).toBe('push');
  });

  it('remote version ahead, no local pending mutation → pull (remote ahead)', () => {
    // local aceptó la versión 3 en t=10:00; remoto ya va por 4 en t=10:03; local no tocó nada después
    const r = reconcile({
      local: { version: 3, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote: remoteAt(4, '2026-06-06T10:03:00.000Z'),
    });
    expect(r.action).toBe('pull');
  });

  it('remote version ahead AND local has pending mutation → conflict (both changed)', () => {
    // local aceptó v3 en 10:00, luego mutó local a 10:07 (pending); remoto avanzó a v4 en 10:03
    const r = reconcile({
      local: { version: 3, updatedAt: '2026-06-06T10:07:00.000Z' },
      remote: remoteAt(4, '2026-06-06T10:03:00.000Z'),
    });
    expect(r.action).toBe('conflict');
  });

  it('local version greater than remote (defensive) → push', () => {
    const r = reconcile({
      local: { version: 5, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote: remoteAt(4, '2026-06-06T09:00:00.000Z'),
    });
    expect(r.action).toBe('push');
  });

  it('every result includes a non-empty reason', () => {
    const r = reconcile({ local: { version: 0, updatedAt: '2026-06-06T10:00:00.000Z' }, remote: null });
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
