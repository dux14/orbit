// lib/linking/classify.ts
import type { RemoteVault, VaultMeta } from '@/lib/sync/types';
import { LinkError, type LinkClassification } from './types';

export interface ClassifyInput {
  localMeta: VaultMeta | undefined;
  remote: RemoteVault | null;
}

/** Parse tipado de la meta remota: una fila corrupta no debe filtrar SyntaxError crudo. */
export function parseRemoteMeta(encryptedMeta: string): VaultMeta {
  try {
    return JSON.parse(encryptedMeta) as VaultMeta;
  } catch {
    throw new LinkError('unknown', 'Malformed remote vault meta');
  }
}

/** Decide la situación de vinculación. PURA: sin I/O. */
export function classifySituation({ localMeta, remote }: ClassifyInput): LinkClassification {
  if (!localMeta && !remote) {
    return { situation: 'no-remote-no-local', remote: null, hasLocal: false };
  }
  if (!localMeta) {
    return { situation: 'remote-only', remote, hasLocal: false };
  }
  if (!remote) {
    return { situation: 'local-only', remote: null, hasLocal: true };
  }

  // localMeta && remote — comparar KDF salt para decidir si es el mismo vault.
  const remoteMeta = parseRemoteMeta(remote.encryptedMeta);
  const sameVault = localMeta.kdf.salt === remoteMeta.kdf.salt;
  return {
    situation: sameVault ? 'both-same' : 'both-different',
    remote,
    hasLocal: true,
  };
}
