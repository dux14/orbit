import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { vaultService } from '@/lib/services/vault-service';
import { exportBackup, importBackup } from '@/lib/services/backup';
import { deriveKey, encrypt, createVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import type { BackupFile, VaultData } from '@/lib/types';

beforeEach(async () => { await db.delete(); await db.open(); });

/** Build a legacy v0 backup file exactly as the pre-envelope app exported it. */
async function makeLegacyBackup(password: string, data: VaultData): Promise<BackupFile> {
  const kdf = { ...defaultKdf(), salt: generateSalt() };
  const key = await deriveKey(password, kdf);
  const verifier = await createVerifier(key);
  return {
    format: 'orbit-backup',
    schemaVersion: 1,
    meta: { schemaVersion: 1, kdf, verifier }, // NO envelopeVersion/wrappedKeys
    data: await encrypt(key, JSON.stringify(data)),
  };
}

describe('backup', () => {
  it('exports a backup then imports it into a fresh db with the same password', async () => {
    const session = await vaultService.create('pw');
    await vaultService.persist(session.key, { ...session.data, paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] });
    const file = await exportBackup();

    await db.delete(); await db.open(); // simulate cleared browser
    expect(await vaultService.exists()).toBe(false);

    const restored = await importBackup(file, 'pw');
    expect(restored.data.paymentMethods).toHaveLength(1);
    expect(await vaultService.exists()).toBe(true);
  });

  it('rejects import with the wrong password', async () => {
    await vaultService.create('pw');
    const file = await exportBackup();
    await db.delete(); await db.open();
    await expect(importBackup(file, 'wrong')).rejects.toThrow(/master password/i);
  });

  it('exports envelope v1 meta and the restored vault unlocks via the envelope path', async () => {
    const created = await vaultService.create('master-pw');
    await vaultService.persist(created.key, { ...created.data, paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] });

    const file = await exportBackup();
    expect(file.meta.envelopeVersion).toBe(1);
    expect(typeof file.meta.wrappedKeys?.master).toBe('string');

    await db.delete(); await db.open();
    const session = await importBackup(file, 'master-pw');
    expect(session.data.paymentMethods).toHaveLength(1);

    const next = await vaultService.unlock('master-pw');
    expect(next.data.paymentMethods).toHaveLength(1);
  });

  it('imports a legacy v0 backup; vault stays v0 and migrates on next unlock', async () => {
    const data: VaultData = { subscriptions: [], credentials: [], paymentMethods: [{ id: '1', label: 'L', brand: 'Visa', last4: '1111', color: '#000' }] };
    const file = await makeLegacyBackup('old-pw', data);

    const session = await importBackup(file, 'old-pw');
    expect(session.data.paymentMethods).toHaveLength(1);
    expect((await repository.getMeta())?.envelopeVersion).toBeUndefined(); // restored verbatim

    const next = await vaultService.unlock('old-pw'); // triggers transparent migration
    expect(next.data.paymentMethods).toHaveLength(1);
    expect((await repository.getMeta())?.envelopeVersion).toBe(1);
  });

  it('rejects a legacy v0 backup with the wrong password', async () => {
    const file = await makeLegacyBackup('right', { subscriptions: [], credentials: [], paymentMethods: [] });
    await expect(importBackup(file, 'wrong')).rejects.toThrow(/master password/i);
  });
});
