// lib/linking/types.ts
import type { RemoteVault } from '@/lib/sync/types';

/** Situación detectada al iniciar sesión, que determina el flujo de vinculación. */
export type LinkSituation =
  | 'no-remote-no-local'   // cuenta nueva sin vault en ningún lado → onboarding normal
  | 'remote-only'          // dispositivo nuevo: hay remoto, no hay local → pedir password y bajar
  | 'local-only'           // hay vault local, no remoto → push inicial
  | 'both-same'            // local y remoto comparten KDF salt (mismo vault) → reconcile normal (S6)
  | 'both-different';      // local y remoto con salts distintos → vaults distintos, elección destructiva

export interface LinkClassification {
  situation: LinkSituation;
  remote: RemoteVault | null;
  hasLocal: boolean;
}

/** Estado de la pantalla de vinculación. */
export type LinkPhase = 'detecting' | 'need-password' | 'resolving' | 'choice' | 'done' | 'error';

export interface LinkState {
  phase: LinkPhase;
  situation: LinkSituation | null;
  remote: RemoteVault | null;
  error: LinkErrorCode | null;
}

export type LinkErrorCode =
  | 'wrong-password'   // verifier no valida con la password introducida
  | 'offline'          // sin red al intentar pull/push
  | 'no-session'       // no hay sesión Supabase
  | 'unknown';

export class LinkError extends Error {
  constructor(readonly code: LinkErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LinkError';
  }
}
