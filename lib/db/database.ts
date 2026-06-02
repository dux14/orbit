import Dexie, { type Table } from 'dexie';
import type { VaultMeta, Settings, FxRatesCache } from '@/lib/types';

interface KeyedRow<T> { key: string; value: T; }

export class OrbitDB extends Dexie {
  meta!: Table<KeyedRow<VaultMeta>, string>;
  blob!: Table<KeyedRow<string>, string>;      // encrypted VaultData
  settings!: Table<KeyedRow<Settings>, string>; // plaintext (no secrets)
  fx!: Table<KeyedRow<FxRatesCache>, string>;   // plaintext

  constructor() {
    super('orbit');
    this.version(1).stores({ meta: 'key', blob: 'key', settings: 'key', fx: 'key' });
  }
}

export const db = new OrbitDB();
