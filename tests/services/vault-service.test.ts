import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { vaultService } from '@/lib/services/vault-service';
import { encrypt, decrypt } from '@/lib/crypto/vault';

const empty = () => ({ subscriptions: [], credentials: [], paymentMethods: [] });

beforeEach(async () => { await db.delete(); await db.open(); });

describe('vaultService', () => {
  it('creates a vault and returns key + empty data', async () => {
    const session = await vaultService.create('master-pw');
    expect(session.data).toEqual(empty());
    expect(await vaultService.exists()).toBe(true);
  });

  it('unlocks with the correct password', async () => {
    await vaultService.create('master-pw');
    const session = await vaultService.unlock('master-pw');
    expect(session.data).toEqual(empty());
  });

  it('rejects the wrong password', async () => {
    await vaultService.create('master-pw');
    await expect(vaultService.unlock('wrong')).rejects.toThrow(/master password/i);
  });

  it('persists data and reads it back on next unlock', async () => {
    const session = await vaultService.create('pw');
    const data = { ...empty(), paymentMethods: [{ id: '1', label: 'Main', brand: 'Visa', last4: '4242', color: '#fff' }] };
    await vaultService.persist(session.key, data);
    const next = await vaultService.unlock('pw');
    expect(next.data.paymentMethods).toHaveLength(1);
  });

  it('create writes envelope v1 meta (envelopeVersion + wrappedKeys.master)', async () => {
    await vaultService.create('master-pw');
    const meta = await repository.getMeta();
    expect(meta?.envelopeVersion).toBe(1);
    expect(typeof meta?.wrappedKeys?.master).toBe('string');
    expect(meta?.wrappedKeys?.master.length).toBeGreaterThan(0);
  });

  it('unlock returns the VaultKey (same material across unlocks), not the KEK', async () => {
    const created = await vaultService.create('pw');
    const data = { ...empty(), paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] };
    await vaultService.persist(created.key, data);
    const next = await vaultService.unlock('pw');
    expect(next.data.paymentMethods).toHaveLength(1);
    // The returned key is the VaultKey: it must be the SAME material across unlocks
    // (re-deriving KEK each time, but unwrapping the same stored VaultKey).
    const again = await vaultService.unlock('pw');
    const ct = await encrypt(next.key, 'probe');
    expect(await decrypt(again.key, ct)).toBe('probe');
  });
});
