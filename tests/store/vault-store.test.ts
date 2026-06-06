import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { vaultStore } from '@/lib/store/vault-store';

beforeEach(async () => { await db.delete(); await db.open(); vaultStore.getState().reset(); });

describe('vaultStore', () => {
  it('starts locked', () => {
    expect(vaultStore.getState().locked).toBe(true);
  });
  it('create unlocks and exposes empty data', async () => {
    await vaultStore.getState().createVault('pw');
    expect(vaultStore.getState().locked).toBe(false);
    expect(vaultStore.getState().data?.subscriptions).toEqual([]);
  });
  it('lock wipes the key and data from memory', async () => {
    await vaultStore.getState().createVault('pw');
    vaultStore.getState().lock();
    expect(vaultStore.getState().locked).toBe(true);
    expect(vaultStore.getState().data).toBeNull();
  });
  it('upsertSubscription persists and is readable after unlock', async () => {
    await vaultStore.getState().createVault('pw');
    await vaultStore.getState().upsertSubscription({
      id: '', serviceName: 'Netflix', category: 'video', amount: 15, currency: 'USD',
      billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active', createdAt: '', updatedAt: '',
    });
    vaultStore.getState().lock();
    await vaultStore.getState().unlock('pw');
    expect(vaultStore.getState().data?.subscriptions).toHaveLength(1);
    expect(vaultStore.getState().data?.subscriptions[0].id).not.toBe('');
  });
  it('deleteSubscription removes it', async () => {
    await vaultStore.getState().createVault('pw');
    await vaultStore.getState().upsertSubscription({
      id: '', serviceName: 'X', category: 'misc', amount: 1, currency: 'USD',
      billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active', createdAt: '', updatedAt: '',
    });
    const id = vaultStore.getState().data!.subscriptions[0].id;
    await vaultStore.getState().deleteSubscription(id);
    expect(vaultStore.getState().data?.subscriptions).toHaveLength(0);
  });
  it('upsertPaymentMethod returns the generated id for new cards', async () => {
    await vaultStore.getState().createVault('pw');
    const id = await vaultStore.getState().upsertPaymentMethod({
      id: '', label: 'Personal Visa', brand: 'Visa', last4: '4242', color: '#b8c8f0',
    });
    expect(id).toBeTruthy();
    expect(vaultStore.getState().data?.paymentMethods).toHaveLength(1);
    expect(vaultStore.getState().data?.paymentMethods[0].id).toBe(id);
  });
  it('upsertPaymentMethod returns the same id when editing', async () => {
    await vaultStore.getState().createVault('pw');
    const id = await vaultStore.getState().upsertPaymentMethod({
      id: '', label: 'A', brand: 'Visa', last4: '1111', color: '#b8c8f0',
    });
    const again = await vaultStore.getState().upsertPaymentMethod({
      id, label: 'A renamed', brand: 'Visa', last4: '1111', color: '#b8c8f0',
    });
    expect(again).toBe(id);
    expect(vaultStore.getState().data?.paymentMethods).toHaveLength(1);
    expect(vaultStore.getState().data?.paymentMethods[0].label).toBe('A renamed');
  });
});
