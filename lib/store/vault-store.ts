import { createStore } from 'zustand/vanilla';
import { vaultService } from '@/lib/services/vault-service';
import type { VaultData, Subscription, PaymentMethod, Credential } from '@/lib/types';

function uid(): string {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;
}

interface VaultState {
  locked: boolean;
  key: CryptoKey | null;
  data: VaultData | null;
  createVault: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  reset: () => void; // test helper
  upsertSubscription: (sub: Subscription) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  upsertPaymentMethod: (pm: PaymentMethod) => Promise<void>;
  deletePaymentMethod: (id: string) => Promise<void>;
  upsertCredential: (c: Credential) => Promise<string>;
}

async function persist(get: () => VaultState) {
  const { key, data } = get();
  if (key && data) await vaultService.persist(key, data);
}

export const vaultStore = createStore<VaultState>((set, get) => ({
  locked: true,
  key: null,
  data: null,

  async createVault(password) {
    const { key, data } = await vaultService.create(password);
    set({ key, data, locked: false });
  },
  async unlock(password) {
    const { key, data } = await vaultService.unlock(password);
    set({ key, data, locked: false });
  },
  lock() {
    set({ key: null, data: null, locked: true });
  },
  reset() {
    set({ key: null, data: null, locked: true });
  },

  async upsertSubscription(sub) {
    const data = get().data!;
    const now = new Date().toISOString();
    const exists = sub.id && data.subscriptions.some((s) => s.id === sub.id);
    const next = exists
      ? data.subscriptions.map((s) => (s.id === sub.id ? { ...sub, updatedAt: now } : s))
      : [...data.subscriptions, { ...sub, id: uid(), createdAt: now, updatedAt: now }];
    set({ data: { ...data, subscriptions: next } });
    await persist(get);
  },
  async deleteSubscription(id) {
    const data = get().data!;
    set({ data: { ...data, subscriptions: data.subscriptions.filter((s) => s.id !== id) } });
    await persist(get);
  },
  async upsertPaymentMethod(pm) {
    const data = get().data!;
    const exists = pm.id && data.paymentMethods.some((p) => p.id === pm.id);
    const next = exists
      ? data.paymentMethods.map((p) => (p.id === pm.id ? pm : p))
      : [...data.paymentMethods, { ...pm, id: uid() }];
    set({ data: { ...data, paymentMethods: next } });
    await persist(get);
  },
  async deletePaymentMethod(id) {
    const data = get().data!;
    set({ data: { ...data, paymentMethods: data.paymentMethods.filter((p) => p.id !== id) } });
    await persist(get);
  },
  async upsertCredential(c) {
    const data = get().data!;
    const id = c.id || uid();
    const exists = data.credentials.some((x) => x.id === id);
    const next = exists ? data.credentials.map((x) => (x.id === id ? { ...c, id } : x)) : [...data.credentials, { ...c, id }];
    set({ data: { ...data, credentials: next } });
    await persist(get);
    return id;
  },
}));
