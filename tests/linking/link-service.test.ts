// tests/linking/link-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LinkService } from '@/lib/linking/link-service';
import { LinkError } from '@/lib/linking/types';
import { deriveKey, encrypt, createVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import type { RemoteVault } from '@/lib/sync/types';
import type { VaultData, VaultMeta } from '@/lib/types';

const PW = 'TestPassword1!';

/** Construye un RemoteVault cifrado con una password y datos dados. */
async function makeRemote(pw: string, data: VaultData): Promise<RemoteVault> {
  const kdf = { ...defaultKdf(), salt: generateSalt() };
  const key = await deriveKey(pw, kdf);
  const verifier = await createVerifier(key);
  const meta: VaultMeta = { schemaVersion: 1, kdf, verifier };
  const blob = await encrypt(key, JSON.stringify(data));
  return { encryptedMeta: JSON.stringify(meta), encryptedBlob: blob, version: 2, updatedAt: '2026-06-06T10:00:00.000Z' };
}

function makeRepo(remote: RemoteVault | null) {
  return {
    pullVault: vi.fn().mockResolvedValue(remote),
    pushVault: vi.fn().mockResolvedValue({ ...(remote ?? ({} as RemoteVault)), version: 1, updatedAt: '2026-06-06T11:00:00.000Z' }),
  };
}

describe('LinkService', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    vaultStore.getState().reset();
    vi.clearAllMocks();
  });

  it('detect() returns remote-only on a fresh device with a remote vault', async () => {
    const remote = await makeRemote(PW, { subscriptions: [], credentials: [], paymentMethods: [] });
    const svc = new LinkService(makeRepo(remote) as never);
    const c = await svc.detect();
    expect(c.situation).toBe('remote-only');
  });

  it('linkNewDevice decrypts remote with correct password and hydrates local + store', async () => {
    const data: VaultData = { subscriptions: [{ id: 's1', serviceName: 'Netflix', category: 'streaming', amount: 9.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-12-31', status: 'active', createdAt: '', updatedAt: '' }], credentials: [], paymentMethods: [] };
    const remote = await makeRemote(PW, data);
    const repo = makeRepo(remote);
    const svc = new LinkService(repo as never);

    await svc.linkNewDevice(PW);

    // Store hidratado con los datos remotos
    expect(vaultStore.getState().data?.subscriptions[0].serviceName).toBe('Netflix');
    expect(vaultStore.getState().locked).toBe(false);
    // Persistido localmente (meta + sync state con la versión remota)
    expect(await repository.vaultExists()).toBe(true);
    expect((await repository.getSyncState())?.version).toBe(2);
  });

  it('linkNewDevice throws wrong-password LinkError on bad password', async () => {
    const remote = await makeRemote(PW, { subscriptions: [], credentials: [], paymentMethods: [] });
    const svc = new LinkService(makeRepo(remote) as never);
    await expect(svc.linkNewDevice('WrongPassword9!')).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it('linkNewDevice throws offline LinkError when pull fails with network error', async () => {
    const repo = makeRepo(null);
    repo.pullVault.mockRejectedValueOnce(new Error('Failed to fetch'));
    const svc = new LinkService(repo as never);
    await expect(svc.linkNewDevice(PW)).rejects.toBeInstanceOf(LinkError);
  });

  it('linkLocalVault pushes the local vault as the initial remote', async () => {
    // Sembrar un vault local
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey(PW, kdf);
    const meta: VaultMeta = { schemaVersion: 1, kdf, verifier: await createVerifier(key) };
    const blob = await encrypt(key, JSON.stringify({ subscriptions: [], credentials: [], paymentMethods: [] }));
    await repository.createVault(meta, blob);

    const repo = makeRepo(null);
    const svc = new LinkService(repo as never);
    await svc.linkLocalVault();

    expect(repo.pushVault).toHaveBeenCalledWith(JSON.stringify(meta), blob, 0);
    expect((await repository.getSyncState())?.version).toBe(1);
  });
});
