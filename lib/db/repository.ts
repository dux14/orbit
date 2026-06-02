import { db } from './database';
import type { VaultMeta, Settings, FxRatesCache } from '@/lib/types';

const META_KEY = 'meta';
const BLOB_KEY = 'blob';
const SETTINGS_KEY = 'settings';
const FX_KEY = 'fx';

export const repository = {
  async vaultExists(): Promise<boolean> {
    return (await db.meta.get(META_KEY)) !== undefined;
  },
  async createVault(meta: VaultMeta, encryptedData: string): Promise<void> {
    await db.transaction('rw', db.meta, db.blob, async () => {
      await db.meta.put({ key: META_KEY, value: meta });
      await db.blob.put({ key: BLOB_KEY, value: encryptedData });
    });
  },
  async getMeta(): Promise<VaultMeta | undefined> {
    return (await db.meta.get(META_KEY))?.value;
  },
  async getEncryptedData(): Promise<string | undefined> {
    return (await db.blob.get(BLOB_KEY))?.value;
  },
  async saveEncryptedData(encryptedData: string): Promise<void> {
    await db.blob.put({ key: BLOB_KEY, value: encryptedData });
  },
  async getSettings(): Promise<Settings | undefined> {
    return (await db.settings.get(SETTINGS_KEY))?.value;
  },
  async saveSettings(settings: Settings): Promise<void> {
    await db.settings.put({ key: SETTINGS_KEY, value: settings });
  },
  async getFxCache(): Promise<FxRatesCache | undefined> {
    return (await db.fx.get(FX_KEY))?.value;
  },
  async saveFxCache(fx: FxRatesCache): Promise<void> {
    await db.fx.put({ key: FX_KEY, value: fx });
  },
  async wipeVault(): Promise<void> {
    await db.transaction('rw', db.meta, db.blob, db.settings, db.fx, async () => {
      await Promise.all([db.meta.clear(), db.blob.clear(), db.settings.clear(), db.fx.clear()]);
    });
  },
};
