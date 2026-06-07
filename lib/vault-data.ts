import type { VaultData } from '@/lib/types';

/**
 * Runtime shape guard for decrypted vault payloads. Decryption succeeding
 * proves key possession, not payload shape — storage corruption or a future
 * schema bug would otherwise surface as confusing downstream TypeErrors.
 */
export function assertVaultData(x: unknown): asserts x is VaultData {
  const d = x as VaultData | null;
  if (
    !d ||
    typeof d !== 'object' ||
    !Array.isArray(d.subscriptions) ||
    !Array.isArray(d.credentials) ||
    !Array.isArray(d.paymentMethods)
  ) {
    throw new Error('Decrypted vault payload has an unexpected shape');
  }
}
