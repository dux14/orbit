import type { VaultMeta } from '@/lib/types';

/**
 * Migrate a legacy v0 vault (KDF key encrypts the blob directly) to envelope v1.
 * Implemented in S9-T5; stub keeps the unlock call site compiling until then.
 */
export async function migrateLegacyVault(_password: string, _meta: VaultMeta): Promise<VaultMeta> {
  throw new Error('legacy vault migration not implemented yet');
}
