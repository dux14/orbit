import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { vaultService } from '@/lib/services/vault-service';
import { exportBackup, importBackup } from '@/lib/services/backup';

beforeEach(async () => { await db.delete(); await db.open(); });

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
});
