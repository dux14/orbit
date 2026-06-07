// lib/linking/classify.ts
import type { RemoteVault, VaultMeta } from '@/lib/sync/types';
import type { LinkClassification } from './types';

export interface ClassifyInput {
  localMeta: VaultMeta | undefined;
  remote: RemoteVault | null;
}

/** Decide la situación de vinculación. PURA: sin I/O. */
export function classifySituation({ localMeta, remote }: ClassifyInput): LinkClassification {
  if (!localMeta && !remote) {
    return { situation: 'no-remote-no-local', remote: null, hasLocal: false };
  }
  if (!localMeta && remote) {
    return { situation: 'remote-only', remote, hasLocal: false };
  }
  if (localMeta && !remote) {
    return { situation: 'local-only', remote: null, hasLocal: true };
  }

  // localMeta && remote — comparar KDF salt para decidir si es el mismo vault.
  const remoteMeta = JSON.parse(remote!.encryptedMeta) as VaultMeta;
  const sameVault = localMeta!.kdf.salt === remoteMeta.kdf.salt;
  return {
    situation: sameVault ? 'both-same' : 'both-different',
    remote,
    hasLocal: true,
  };
}
