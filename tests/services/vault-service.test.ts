import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { vaultService } from '@/lib/services/vault-service';

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
});
