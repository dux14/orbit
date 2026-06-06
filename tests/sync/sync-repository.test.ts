// tests/sync/sync-repository.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncRepository } from '@/lib/sync/sync-repository';
import { ConflictError } from '@/lib/sync/types';

// Mock mínimo de SupabaseClient: solo lo que usa el repositorio.
function makeClient(opts: {
  selectResult?: { data: unknown; error: unknown };
  rpcResult?: { data: unknown; error: unknown };
}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? { data: null, error: null });
  const maybeSingle = vi.fn().mockResolvedValue(opts.selectResult ?? { data: null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from, rpc } as any, spies: { from, select, eq, maybeSingle, rpc } };
}

describe('SyncRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pullVault returns null when no remote row', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: null } });
    const repo = new SyncRepository(client, 'user-1');
    expect(await repo.pullVault()).toBeNull();
  });

  it('pullVault maps a remote row to RemoteVault', async () => {
    const { client } = makeClient({
      selectResult: {
        data: { encrypted_meta: 'META', encrypted_blob: 'BLOB', version: 7, updated_at: '2026-06-06T10:00:00.000Z' },
        error: null,
      },
    });
    const repo = new SyncRepository(client, 'user-1');
    expect(await repo.pullVault()).toEqual({
      encryptedMeta: 'META', encryptedBlob: 'BLOB', version: 7, updatedAt: '2026-06-06T10:00:00.000Z',
    });
  });

  it('pullVault throws on a non-"no rows" supabase error', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: { code: '500', message: 'boom' } } });
    const repo = new SyncRepository(client, 'user-1');
    await expect(repo.pullVault()).rejects.toThrow(/boom/);
  });

  it('pushVault calls upsert_vault RPC with opaque ciphertext only', async () => {
    const { client, spies } = makeClient({
      rpcResult: {
        data: { encrypted_meta: 'META', encrypted_blob: 'BLOB', version: 2, updated_at: '2026-06-06T10:00:00.000Z' },
        error: null,
      },
    });
    const repo = new SyncRepository(client, 'user-1');
    const result = await repo.pushVault('META', 'BLOB', 1);

    expect(spies.rpc).toHaveBeenCalledWith('upsert_vault', {
      p_meta: 'META', p_blob: 'BLOB', p_expected_version: 1,
    });
    // Lo que se manda son strings opacas; ningún argumento es CryptoKey ni objeto plaintext.
    const [, args] = spies.rpc.mock.calls[0];
    for (const v of Object.values(args)) {
      expect(typeof v === 'string' || typeof v === 'number').toBe(true);
    }
    expect(result.version).toBe(2);
  });

  it('pushVault maps errcode 40001 to ConflictError', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { code: '40001', message: 'version_conflict' } },
    });
    const repo = new SyncRepository(client, 'user-1');
    await expect(repo.pushVault('META', 'BLOB', 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it('pushVault maps a "version_conflict" message to ConflictError even without code', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { code: 'P0001', message: 'version_conflict' } },
    });
    const repo = new SyncRepository(client, 'user-1');
    await expect(repo.pushVault('META', 'BLOB', 1)).rejects.toBeInstanceOf(ConflictError);
  });
});
