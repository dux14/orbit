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

/** Construye un RemoteVault v0 legado cifrado con una password y datos dados. */
async function makeRemote(pw: string, data: VaultData): Promise<RemoteVault> {
  const kdf = { ...defaultKdf(), salt: generateSalt() };
  const key = await deriveKey(pw, kdf);
  const verifier = await createVerifier(key);
  const meta: VaultMeta = { schemaVersion: 1, kdf, verifier };
  const blob = await encrypt(key, JSON.stringify(data));
  return { encryptedMeta: JSON.stringify(meta), encryptedBlob: blob, version: 2, updatedAt: '2026-06-06T10:00:00.000Z' };
}

/** Construye un RemoteVault envelope v1 (verifier y blob bajo VaultKey envuelta). */
async function makeRemoteV1(pw: string, data: VaultData): Promise<RemoteVault> {
  const { generateVaultKey, deriveKekFromPassword, wrapVaultKey } = await import('@/lib/crypto/envelope');
  const kdf = { ...defaultKdf(), salt: generateSalt() };
  const kek = await deriveKekFromPassword(pw, kdf);
  const vaultKey = await generateVaultKey();
  const meta: VaultMeta = {
    schemaVersion: 1,
    kdf,
    verifier: await createVerifier(vaultKey),
    envelopeVersion: 1,
    wrappedKeys: { master: await wrapVaultKey(vaultKey, kek) },
  };
  const blob = await encrypt(vaultKey, JSON.stringify(data));
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

  it('linkNewDevice rejects a remote meta with degraded KDF params (downgrade defense)', async () => {
    // Meta envenenada: KDF por debajo del piso, verifier VÁLIDO bajo esa KDF débil
    // (peor caso: el atacante conoce la password). El piso debe rechazarla antes
    // de derivar — el verifier prueba posesión de password, no fuerza de params.
    const weakKdf = { ...defaultKdf(), salt: generateSalt(), memorySize: 8, iterations: 1 };
    const weakKey = await deriveKey(PW, weakKdf);
    const meta: VaultMeta = { schemaVersion: 1, kdf: weakKdf, verifier: await createVerifier(weakKey) };
    const blob = await encrypt(weakKey, JSON.stringify({ subscriptions: [], credentials: [], paymentMethods: [] }));
    const remote: RemoteVault = { encryptedMeta: JSON.stringify(meta), encryptedBlob: blob, version: 2, updatedAt: '2026-06-06T10:00:00.000Z' };

    const svc = new LinkService(makeRepo(remote) as never);
    await expect(svc.linkNewDevice(PW)).rejects.toMatchObject({ code: 'unknown' });
    // Nada persistido: el vault local no debe existir tras el rechazo.
    expect(await repository.vaultExists()).toBe(false);
  });

  it('linkNewDevice links an envelope v1 remote vault (unwrap VaultKey, not KDF key)', async () => {
    const data: VaultData = { subscriptions: [{ id: 's1', serviceName: 'Netflix', category: 'streaming', amount: 9.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-12-31', status: 'active', createdAt: '', updatedAt: '' }], credentials: [], paymentMethods: [] };
    const remote = await makeRemoteV1(PW, data);
    const svc = new LinkService(makeRepo(remote) as never);

    await svc.linkNewDevice(PW);

    expect(vaultStore.getState().data?.subscriptions[0].serviceName).toBe('Netflix');
    expect(vaultStore.getState().locked).toBe(false);
    // La meta v1 se persiste tal cual (envelopeVersion intacto)
    expect((await repository.getMeta())?.envelopeVersion).toBe(1);
  });

  it('linkNewDevice invalidates a stale bio credential from a previous vault', async () => {
    await repository.saveBio({ credentialId: 'abc', prfSalt: 'c2FsdA==', wrappedVaultKey: 'd3JhcA==', createdAt: '2026-06-06T00:00:00Z' });
    const remote = await makeRemoteV1(PW, { subscriptions: [], credentials: [], paymentMethods: [] });
    const svc = new LinkService(makeRepo(remote) as never);

    await svc.linkNewDevice(PW);

    // El vault vinculado tiene otra VaultKey: la credencial vieja debe borrarse.
    expect(await repository.getBio()).toBeUndefined();
  });

  it('linkNewDevice rejects wrong password on an envelope v1 remote (AES-KW rejection)', async () => {
    const remote = await makeRemoteV1(PW, { subscriptions: [], credentials: [], paymentMethods: [] });
    const svc = new LinkService(makeRepo(remote) as never);
    await expect(svc.linkNewDevice('WrongPassword9!')).rejects.toMatchObject({ code: 'wrong-password' });
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

  it('linkLocalVault(remoteVersion) pushes with the remote version as expected base', async () => {
    // Sembrar un vault local
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey(PW, kdf);
    const meta: VaultMeta = { schemaVersion: 1, kdf, verifier: await createVerifier(key) };
    const blob = await encrypt(key, JSON.stringify({ subscriptions: [], credentials: [], paymentMethods: [] }));
    await repository.createVault(meta, blob);

    const repo = makeRepo(null);
    const svc = new LinkService(repo as never);
    await svc.linkLocalVault(7);

    expect(repo.pushVault).toHaveBeenCalledWith(JSON.stringify(meta), blob, 7);
  });
});
