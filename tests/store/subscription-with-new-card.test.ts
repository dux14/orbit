import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { vaultStore } from '@/lib/store/vault-store';
import { saveSubscriptionWithDraftCard } from '@/lib/services/save-subscription';
import type { Subscription } from '@/lib/types';

beforeEach(async () => { await db.delete(); await db.open(); vaultStore.getState().reset(); });

const baseSub: Subscription = {
  id: '', serviceName: 'Netflix', category: '', amount: 15, currency: 'USD',
  billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active',
  createdAt: '', updatedAt: '',
};

describe('saveSubscriptionWithDraftCard', () => {
  it('creates the payment method FIRST, then assigns its id to the subscription', async () => {
    await vaultStore.getState().createVault('pw');
    const store = vaultStore.getState();
    await saveSubscriptionWithDraftCard(store, baseSub, undefined, {
      label: 'Gift Visa', brand: 'Visa', last4: '4242', color: '#b8c8f0',
    });
    const { paymentMethods, subscriptions } = vaultStore.getState().data!;
    expect(paymentMethods).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].paymentMethodId).toBe(paymentMethods[0].id);
    expect(paymentMethods[0].id).toBeTruthy();
  });

  it('creates no card when draft is undefined', async () => {
    await vaultStore.getState().createVault('pw');
    await saveSubscriptionWithDraftCard(vaultStore.getState(), baseSub, undefined, undefined);
    expect(vaultStore.getState().data!.paymentMethods).toHaveLength(0);
    expect(vaultStore.getState().data!.subscriptions[0].paymentMethodId).toBeUndefined();
  });

  it('keeps an explicitly selected existing card id when no draft', async () => {
    await vaultStore.getState().createVault('pw');
    const pmId = await vaultStore.getState().upsertPaymentMethod({
      id: '', label: 'Existing', brand: 'Visa', last4: '0001', color: '#b8c8f0',
    });
    await saveSubscriptionWithDraftCard(
      vaultStore.getState(), { ...baseSub, paymentMethodId: pmId }, undefined, undefined,
    );
    expect(vaultStore.getState().data!.subscriptions[0].paymentMethodId).toBe(pmId);
    expect(vaultStore.getState().data!.paymentMethods).toHaveLength(1);
  });
});
