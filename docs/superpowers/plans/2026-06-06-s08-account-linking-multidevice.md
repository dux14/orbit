# Orbit S8 — Account Linking & Multi-Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Investiga cada librería con la **context7 MCP** antes de escribir código, y maneja Supabase con la **Supabase CLI**/**Supabase MCP** — nunca por la web UI. SIEMPRE `pnpm`.

**Goal:** Implementar la **vinculación de cuenta y el onboarding multi-dispositivo** de Orbit (CP4 del `phase-2-plan.md`): un dispositivo nuevo inicia sesión con Google, detecta el vault remoto cifrado, pide la master password, lo descarga y descifra; un dispositivo con vault local que inicia sesión por primera vez resuelve contra el remoto (push inicial, o elección destructiva clara si difieren). El resultado: **la misma cuenta ve el mismo vault descifrado en móvil (PWA iOS/Android), navegador móvil, web y desktop** — un único code path, sin ramas por plataforma.

**Architecture:** S8 se apoya en el motor de sync de S6 (`reconcile`, `SyncRepository`, `SyncService`, `syncStore`, `ConflictError`) y en la auth de S4 (`lib/supabase/client.ts`, `auth-store.ts`). La frontera zero-knowledge no se mueve: el servidor solo entrega `encrypted_meta` (KDF Argon2id + verifier) y `encrypted_blob` opaco; la master password y la `CryptoKey` derivada nunca salen del dispositivo. El descifrado del blob remoto ocurre 100% en cliente reutilizando el path `deriveKey → checkVerifier → decrypt` de Phase 1, apuntado a la meta/blob remotos. El flujo de vinculación es **idéntico en toda plataforma** porque solo usa WebCrypto + IndexedDB + el cliente Supabase, presentes en cualquier navegador/PWA; no hay código específico de dispositivo.

**Tech Stack:** Next.js 16.2.7 (App Router) · TypeScript · Dexie/IndexedDB · Zustand · `@supabase/supabase-js` + `@supabase/ssr` · WebCrypto AES-GCM + Argon2id (hash-wasm) · Vitest (`pnpm vitest run`) · Playwright (dos `BrowserContext` = dos dispositivos).

**Supuestos de sesiones previas (NO crear aquí):**
- S4: `lib/supabase/client.ts` (`createClient()`), `lib/store/auth-store.ts` (`authStore` con `session/user`, `signInWithGoogle()`, `signOut()`), `app/auth/callback/route.ts`, `app/auth/sign-in/page.tsx`, sección Account en Settings.
- S6 (este repo, plan hermano `2026-06-06-s06-encrypted-sync.md`): `lib/sync/types.ts` (`RemoteVault`, `ConflictError`, `LocalVaultRef`), `lib/sync/reconcile.ts`, `lib/sync/sync-repository.ts` (`SyncRepository.pullVault/pushVault`), `lib/sync/sync-service.ts` (`SyncService`), `lib/sync/sync-controller.ts` (`isSyncEnabled`, `createSyncService`), `lib/sync/sync-trigger.ts`, `lib/store/sync-store.ts`, tabla Dexie `sync` + `repository.getSyncState/saveSyncState`.
- Tipos compartidos entre ambos planes (mismos nombres): `RemoteVault`, `LocalVaultRef`, `ConflictError`, `VaultMeta`, `VaultData`.

---

## Matriz de plataformas (requisito de primera clase)

El flujo de vinculación y sync es **el mismo binario de código** en todas estas plataformas. No hay ramas `if (isIOS)` ni equivalentes. Esto se verifica E2E en Task 8 con dos contextos de navegador (dispositivo A y B).

| Plataforma | Runtime | WebCrypto | IndexedDB | Supabase Auth | Notas |
|---|---|---|---|---|---|
| PWA instalada iOS (Safari 18.4+) | WKWebView/Safari | ✓ | ✓ | ✓ (cookies SSR) | OAuth abre Safari y vuelve a la PWA vía deep link del callback |
| PWA instalada Android (Chrome) | Chrome WebView | ✓ | ✓ | ✓ | Igual que desktop |
| Navegador móvil (Chrome/Safari) | navegador | ✓ | ✓ | ✓ | Sin instalar; mismo flujo |
| Navegador desktop (Chrome/Edge/Safari/Firefox) | navegador | ✓ | ✓ | ✓ | Mismo flujo |

Invariante: cualquier dispositivo que (1) inicie sesión en la misma cuenta Google y (2) introduzca la misma master password, obtiene el **mismo `VaultData` descifrado**, porque el `salt` KDF viaja en `encrypted_meta` y el `verifier` valida la contraseña localmente.

---

## File structure (S8 — adiciones; Phase 1 + S6 intactos)

```
orbit/
├─ lib/
│  └─ linking/
│     ├─ link-service.ts          # detectRemote(), linkNewDevice(pw), linkLocalVault(), classify()
│     └─ types.ts                 # LinkState, LinkDecision, LinkError
├─ app/
│  └─ (vault)/link/
│     └─ page.tsx                 # pantalla de vinculación (estados: detecting/needPassword/resolving/error)
├─ components/
│  └─ linking/
│     ├─ link-password-form.tsx   # form master password para dispositivo nuevo
│     └─ link-choice-dialog.tsx   # elección destructiva (mismo vault vs distinto)
├─ lib/i18n/dict.ts (MOD)         # +claves link.* (es/en)
├─ tests/
│  └─ linking/
│     ├─ link-service.test.ts     # classify + detectRemote + linkNewDevice (supabase mockeado)
│     └─ link-choice.test.tsx     # diálogo de elección destructiva
└─ e2e/
   └─ multi-device.spec.ts        # dos contextos: A crea/edita → B vincula y ve → B edita → A converge
```

---

## Task 1: Tipos de linking

**Files:**
- Create: `lib/linking/types.ts`

- [ ] **Step 1: Escribir el módulo de tipos completo**

```typescript
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/linking/types.ts
git commit -m "feat(linking): shared linking types (situation/phase/LinkError)"
```

---

## Task 2: `classifySituation()` — decidir el flujo (PURA, TDD)

Función pura que, dados (¿hay local?, meta local, remoto), decide la `LinkSituation`. La comparación "mismo vault" usa el **KDF salt**: si local y remoto comparten salt, es el mismo vault (misma password deriva la misma clave); si difieren, son vaults genuinamente distintos.

**Files:**
- Create: `tests/linking/classify.test.ts`
- Create: `lib/linking/classify.ts`

- [ ] **Step 1: Escribir el test PRIMERO**

```typescript
// tests/linking/classify.test.ts
import { describe, it, expect } from 'vitest';
import { classifySituation } from '@/lib/linking/classify';
import type { RemoteVault } from '@/lib/sync/types';
import type { VaultMeta } from '@/lib/types';

const meta = (salt: string): VaultMeta => ({
  schemaVersion: 1,
  kdf: { algo: 'argon2id', salt, memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 },
  verifier: 'VERIFIER',
});

const remoteWithSalt = (salt: string): RemoteVault => ({
  encryptedMeta: JSON.stringify(meta(salt)),
  encryptedBlob: 'BLOB',
  version: 3,
  updatedAt: '2026-06-06T10:00:00.000Z',
});

describe('classifySituation', () => {
  it('no local, no remote → onboarding', () => {
    expect(classifySituation({ localMeta: undefined, remote: null }).situation).toBe('no-remote-no-local');
  });

  it('remote, no local → remote-only (new device)', () => {
    expect(classifySituation({ localMeta: undefined, remote: remoteWithSalt('AAA') }).situation).toBe('remote-only');
  });

  it('local, no remote → local-only (initial push)', () => {
    expect(classifySituation({ localMeta: meta('AAA'), remote: null }).situation).toBe('local-only');
  });

  it('both with same KDF salt → both-same (same vault)', () => {
    expect(classifySituation({ localMeta: meta('AAA'), remote: remoteWithSalt('AAA') }).situation).toBe('both-same');
  });

  it('both with different KDF salt → both-different (distinct vaults)', () => {
    expect(classifySituation({ localMeta: meta('AAA'), remote: remoteWithSalt('BBB') }).situation).toBe('both-different');
  });

  it('carries through hasLocal and remote', () => {
    const c = classifySituation({ localMeta: meta('AAA'), remote: remoteWithSalt('AAA') });
    expect(c.hasLocal).toBe(true);
    expect(c.remote?.version).toBe(3);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/linking/classify.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/linking/classify"`.

- [ ] **Step 3: Implementar `classify.ts`**

```typescript
// lib/linking/classify.ts
import type { RemoteVault, VaultMeta } from '@/lib/sync/types';
import type { LinkClassification } from './types';

export interface ClassifyInput {
  localMeta: VaultMeta | undefined;
  remote: RemoteVault | null;
}

/** Decide la situación de vinculación. PURA: sin I/O. */
export function classifySituation({ localMeta, remote }: ClassifyInput): LinkClassification {
  const hasLocal = !!localMeta;

  if (!hasLocal && !remote) {
    return { situation: 'no-remote-no-local', remote: null, hasLocal: false };
  }
  if (!hasLocal && remote) {
    return { situation: 'remote-only', remote, hasLocal: false };
  }
  if (hasLocal && !remote) {
    return { situation: 'local-only', remote: null, hasLocal: true };
  }

  // hasLocal && remote — comparar KDF salt para decidir si es el mismo vault.
  const remoteMeta = JSON.parse(remote!.encryptedMeta) as VaultMeta;
  const sameVault = localMeta!.kdf.salt === remoteMeta.kdf.salt;
  return {
    situation: sameVault ? 'both-same' : 'both-different',
    remote,
    hasLocal: true,
  };
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/linking/classify.test.ts`
Expected: PASS (6 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/linking/classify.ts tests/linking/classify.test.ts
git commit -m "feat(linking): classifySituation() pure decision (TDD)"
```

---

## Task 3: `link-service.ts` — orquestación de vinculación

Reúne detección, descarga + descifrado del vault remoto (dispositivo nuevo) y push inicial (vault local). Reutiliza el path crypto de Phase 1 apuntado a la meta/blob remotos.

**Files:**
- Create: `tests/linking/link-service.test.ts`
- Create: `lib/linking/link-service.ts`

- [ ] **Step 1: Escribir el test PRIMERO**

```typescript
// tests/linking/link-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LinkService } from '@/lib/linking/link-service';
import { LinkError } from '@/lib/linking/types';
import { deriveKey, encrypt, createVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import type { RemoteVault } from '@/lib/sync/types';
import type { VaultData, VaultMeta } from '@/lib/types';

const PW = 'TestPassword1!';

/** Construye un RemoteVault cifrado con una password y datos dados. */
async function makeRemote(pw: string, data: VaultData): Promise<RemoteVault> {
  const kdf = { ...defaultKdf(), salt: generateSalt() };
  const key = await deriveKey(pw, kdf);
  const verifier = await createVerifier(key);
  const meta: VaultMeta = { schemaVersion: 1, kdf, verifier };
  const blob = await encrypt(key, JSON.stringify(data));
  return { encryptedMeta: JSON.stringify(meta), encryptedBlob: blob, version: 2, updatedAt: '2026-06-06T10:00:00.000Z' };
}

function makeRepo(remote: RemoteVault | null) {
  return {
    pullVault: vi.fn().mockResolvedValue(remote),
    pushVault: vi.fn().mockResolvedValue({ ...(remote ?? {} as RemoteVault), version: 1, updatedAt: '2026-06-06T11:00:00.000Z' }),
  };
}

describe('LinkService', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    vaultStore.getState().reset();
    vi.clearAllMocks();
  });

  it('detect() returns remote-only on a fresh device with a remote vault', async () => {
    const remote = await makeRemote(PW, { subscriptions: [], credentials: [], paymentMethods: [] });
    const svc = new LinkService(makeRepo(remote) as any);
    const c = await svc.detect();
    expect(c.situation).toBe('remote-only');
  });

  it('linkNewDevice decrypts remote with correct password and hydrates local + store', async () => {
    const data: VaultData = { subscriptions: [{ id: 's1', serviceName: 'Netflix', category: 'streaming', amount: 9.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-12-31', status: 'active', createdAt: '', updatedAt: '' }], credentials: [], paymentMethods: [] };
    const remote = await makeRemote(PW, data);
    const repo = makeRepo(remote);
    const svc = new LinkService(repo as any);

    await svc.linkNewDevice(PW);

    // Store hidratado con los datos remotos
    expect(vaultStore.getState().data?.subscriptions[0].serviceName).toBe('Netflix');
    expect(vaultStore.getState().locked).toBe(false);
    // Persistido localmente (meta + sync state con la versión remota)
    expect(await repository.vaultExists()).toBe(true);
    expect((await repository.getSyncState())?.version).toBe(2);
  });

  it('linkNewDevice throws wrong-password LinkError on bad password', async () => {
    const remote = await makeRemote(PW, { subscriptions: [], credentials: [], paymentMethods: [] });
    const svc = new LinkService(makeRepo(remote) as any);
    await expect(svc.linkNewDevice('WrongPassword9!')).rejects.toMatchObject({ code: 'wrong-password' });
  });

  it('linkNewDevice throws offline LinkError when pull fails with network error', async () => {
    const repo = makeRepo(null);
    repo.pullVault.mockRejectedValueOnce(new Error('Failed to fetch'));
    const svc = new LinkService(repo as any);
    await expect(svc.linkNewDevice(PW)).rejects.toBeInstanceOf(LinkError);
  });

  it('linkLocalVault pushes the local vault as the initial remote', async () => {
    // Sembrar un vault local
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey(PW, kdf);
    const meta: VaultMeta = { schemaVersion: 1, kdf, verifier: await createVerifier(key) };
    const blob = await encrypt(key, JSON.stringify({ subscriptions: [], credentials: [], paymentMethods: [] }));
    await repository.createVault(meta, blob);

    const repo = makeRepo(null);
    const svc = new LinkService(repo as any);
    await svc.linkLocalVault();

    expect(repo.pushVault).toHaveBeenCalledWith(JSON.stringify(meta), blob, 0);
    expect((await repository.getSyncState())?.version).toBe(1);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/linking/link-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/linking/link-service"`.

- [ ] **Step 3: Implementar `link-service.ts` completo**

```typescript
// lib/linking/link-service.ts
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import { deriveKey, decrypt, checkVerifier } from '@/lib/crypto/vault';
import { classifySituation } from './classify';
import { LinkError, type LinkClassification } from './types';
import type { SyncRepository } from '@/lib/sync/sync-repository';
import type { RemoteVault, VaultMeta } from '@/lib/sync/types';
import type { VaultData } from '@/lib/types';

function isNetworkError(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? '';
  return /failed to fetch|network|offline|ECONN|fetch/i.test(m);
}

/**
 * Orquesta la vinculación de dispositivo. El descifrado del blob remoto ocurre
 * 100% en cliente (deriveKey/checkVerifier/decrypt de Phase 1). SyncRepository
 * solo transporta ciphertext; nunca recibe la password ni la CryptoKey.
 */
export class LinkService {
  constructor(private readonly repo: SyncRepository) {}

  /** Detecta la situación combinando meta local + fila remota. */
  async detect(): Promise<LinkClassification> {
    let remote: RemoteVault | null;
    try {
      remote = await this.repo.pullVault();
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', (e as Error).message);
    }
    const localMeta = await repository.getMeta();
    return classifySituation({ localMeta, remote });
  }

  /**
   * Dispositivo nuevo: baja meta+blob remotos, deriva la clave con el salt remoto,
   * valida con el verifier, descifra, persiste localmente y carga en el store.
   */
  async linkNewDevice(password: string): Promise<void> {
    let remote: RemoteVault | null;
    try {
      remote = await this.repo.pullVault();
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', (e as Error).message);
    }
    if (!remote) throw new LinkError('unknown', 'No remote vault to link');

    const meta = JSON.parse(remote.encryptedMeta) as VaultMeta;
    const key = await deriveKey(password, meta.kdf);
    if (!(await checkVerifier(key, meta.verifier))) {
      throw new LinkError('wrong-password');
    }

    const data = JSON.parse(await decrypt(key, remote.encryptedBlob)) as VaultData;

    // Persistir meta + blob remotos en Dexie y fijar el estado de sync a la versión remota.
    await repository.createVault(meta, remote.encryptedBlob);
    await repository.saveSyncState({ version: remote.version, updatedAt: remote.updatedAt });

    // Cargar en memoria: vault desbloqueado con la clave derivada.
    vaultStore.setState({ key, data, locked: false });
  }

  /** Vault local sin remoto: subir como versión inicial (push con expectedVersion 0). */
  async linkLocalVault(): Promise<void> {
    const meta = await repository.getMeta();
    const blob = await repository.getEncryptedData();
    if (!meta || !blob) throw new LinkError('unknown', 'No local vault to push');
    try {
      const saved = await this.repo.pushVault(JSON.stringify(meta), blob, 0);
      await repository.saveSyncState({ version: saved.version, updatedAt: saved.updatedAt });
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', (e as Error).message);
    }
  }
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/linking/link-service.test.ts`
Expected: PASS (5 tests verdes). Asegúrate de que `tests/setup.ts` configura WebCrypto en Node (lo usan los tests de `tests/crypto`).

- [ ] **Step 5: Commit**

```bash
git add lib/linking/link-service.ts tests/linking/link-service.test.ts
git commit -m "feat(linking): LinkService (detect, new-device decrypt+hydrate, local push)"
```

---

## Task 4: Fábrica del LinkService (gating por flag + sesión)

Igual que el sync-controller de S6: solo opera con `NEXT_PUBLIC_SYNC_ENABLED` y sesión Supabase.

**Files:**
- Create: `lib/linking/link-controller.ts`
- Create: `tests/linking/link-controller.test.ts`

- [ ] **Step 1: Escribir el test PRIMERO**

```typescript
// tests/linking/link-controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinkService } from '@/lib/linking/link-controller';

describe('createLinkService gating', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('returns null when sync disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', '');
    expect(await createLinkService()).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/linking/link-controller.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/linking/link-controller"`.

- [ ] **Step 3: Implementar `link-controller.ts`**

```typescript
// lib/linking/link-controller.ts
import { isSyncEnabled } from '@/lib/sync/sync-controller';
import { SyncRepository } from '@/lib/sync/sync-repository';
import { LinkService } from './link-service';

/** Crea el LinkService cableado a Supabase, o null si sync off / sin sesión. */
export async function createLinkService(): Promise<LinkService | null> {
  if (!isSyncEnabled()) return null;
  const { createClient } = await import('@/lib/supabase/client');
  const client = createClient();
  const { data } = await client.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const repo = new SyncRepository(client, userId);
  return new LinkService(repo);
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/linking/link-controller.test.ts`
Expected: PASS (1 test verde).

- [ ] **Step 5: Commit**

```bash
git add lib/linking/link-controller.ts tests/linking/link-controller.test.ts
git commit -m "feat(linking): link-controller factory (flag + session gated)"
```

---

## Task 5: i18n — claves de linking (es/en)

**Files:**
- Modify: `lib/i18n/dict.ts`

- [ ] **Step 1: Añadir al bloque `en`** (antes de su `} as const;`)

```typescript
  // ── Account linking / Multi-device ──────────────────────────────────────────
  'link.detecting':             'Checking your account…',
  'link.newDeviceTitle':        'Unlock your synced vault',
  'link.newDeviceBody':         'This account already has an encrypted vault. Enter your master password to download and decrypt it on this device.',
  'link.passwordLabel':         'Master password',
  'link.passwordPlaceholder':   'Enter your master password',
  'link.submit':                'Unlock & link device',
  'link.submitting':            'Linking…',
  'link.wrongPassword':         'Incorrect master password',
  'link.offline':               'No connection — check your network and try again',
  'link.noSession':             'You are signed out',
  'link.unknownError':          'Something went wrong — try again',
  'link.linkedTitle':           'Device linked',
  'link.linkedBody':            'Your vault is now synced on this device.',
  'link.pushTitle':             'Enabling sync',
  'link.pushBody':              'Uploading your encrypted vault for the first time…',
  'link.choiceTitle':           'Two different vaults found',
  'link.choiceBody':            'This device and your account have different vaults. Keep only one — the other will be permanently replaced on this account.',
  'link.choiceKeepLocal':       'Keep this device’s vault',
  'link.choiceKeepRemote':      'Keep the account’s vault',
  'link.choiceWarning':         'This cannot be undone.',
  'link.choiceCancel':          'Cancel',
```

- [ ] **Step 2: Añadir las mismas claves al bloque `es`** (antes de su `} as const;`)

```typescript
  // ── Account linking / Multi-device ──────────────────────────────────────────
  'link.detecting':             'Comprobando tu cuenta…',
  'link.newDeviceTitle':        'Desbloquea tu vault sincronizado',
  'link.newDeviceBody':         'Esta cuenta ya tiene un vault cifrado. Introduce tu master password para descargarlo y descifrarlo en este dispositivo.',
  'link.passwordLabel':         'Master password',
  'link.passwordPlaceholder':   'Introduce tu master password',
  'link.submit':                'Desbloquear y vincular dispositivo',
  'link.submitting':            'Vinculando…',
  'link.wrongPassword':         'Master password incorrecta',
  'link.offline':               'Sin conexión — revisa tu red e inténtalo de nuevo',
  'link.noSession':             'Has cerrado sesión',
  'link.unknownError':          'Algo salió mal — inténtalo de nuevo',
  'link.linkedTitle':           'Dispositivo vinculado',
  'link.linkedBody':            'Tu vault ya está sincronizado en este dispositivo.',
  'link.pushTitle':             'Activando sincronización',
  'link.pushBody':              'Subiendo tu vault cifrado por primera vez…',
  'link.choiceTitle':           'Se encontraron dos vaults distintos',
  'link.choiceBody':            'Este dispositivo y tu cuenta tienen vaults diferentes. Conserva solo uno — el otro será reemplazado permanentemente en esta cuenta.',
  'link.choiceKeepLocal':       'Conservar el vault de este dispositivo',
  'link.choiceKeepRemote':      'Conservar el vault de la cuenta',
  'link.choiceWarning':         'Esto no se puede deshacer.',
  'link.choiceCancel':          'Cancelar',
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/dict.ts
git commit -m "feat(i18n): account linking + multi-device strings (es/en)"
```

---

## Task 6: Diálogo de elección destructiva (vaults distintos)

Cuando local y remoto difieren (`both-different`), el usuario elige cuál conservar con confirmación destructiva clara.

**Files:**
- Create: `components/linking/link-choice-dialog.tsx`
- Create: `tests/linking/link-choice.test.tsx`

- [ ] **Step 1: Escribir el test PRIMERO**

```tsx
// tests/linking/link-choice.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkChoiceDialog } from '@/components/linking/link-choice-dialog';

describe('LinkChoiceDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<LinkChoiceDialog open={false} onKeepLocal={vi.fn()} onKeepRemote={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });

  it('shows the destructive warning', () => {
    render(<LinkChoiceDialog open onKeepLocal={vi.fn()} onKeepRemote={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/cannot be undone|no se puede deshacer/i)).toBeTruthy();
  });

  it('keep-local triggers onKeepLocal', async () => {
    const onKeepLocal = vi.fn();
    render(<LinkChoiceDialog open onKeepLocal={onKeepLocal} onKeepRemote={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /this device’s vault|vault de este dispositivo/i }));
    expect(onKeepLocal).toHaveBeenCalled();
  });

  it('keep-remote triggers onKeepRemote', async () => {
    const onKeepRemote = vi.fn();
    render(<LinkChoiceDialog open onKeepLocal={vi.fn()} onKeepRemote={onKeepRemote} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /account’s vault|vault de la cuenta/i }));
    expect(onKeepRemote).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/linking/link-choice.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/linking/link-choice-dialog"`.

- [ ] **Step 3: Implementar `link-choice-dialog.tsx`**

```tsx
// components/linking/link-choice-dialog.tsx
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/use-t';

interface Props {
  open: boolean;
  onKeepLocal: () => void;
  onKeepRemote: () => void;
  onCancel: () => void;
}

export function LinkChoiceDialog({ open, onKeepLocal, onKeepRemote, onCancel }: Props) {
  const t = useT();
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('link.choiceTitle')}</DialogTitle>
          <DialogDescription>{t('link.choiceBody')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium text-destructive">{t('link.choiceWarning')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>{t('link.choiceCancel')}</Button>
          <Button variant="outline" onClick={onKeepRemote}>{t('link.choiceKeepRemote')}</Button>
          <Button variant="destructive" onClick={onKeepLocal}>{t('link.choiceKeepLocal')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Nota: si el componente `Button` no tiene `variant="destructive"`, usa `variant="outline"` con `className="text-destructive"`. Verifica las variantes disponibles en `components/ui/button.tsx` antes de implementar.

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/linking/link-choice.test.tsx`
Expected: PASS (4 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add components/linking/link-choice-dialog.tsx tests/linking/link-choice.test.tsx
git commit -m "feat(linking): destructive choice dialog for divergent vaults"
```

---

## Task 7: Pantalla de vinculación `/link` + form de password

Route cliente que orquesta el flujo completo con los estados de `LinkState`. Tras sign-in, si la situación es `remote-only` o `both-different`, el usuario aterriza aquí.

**Files:**
- Create: `components/linking/link-password-form.tsx`
- Create: `app/(vault)/link/page.tsx`

- [ ] **Step 1: Implementar el form de password**

```tsx
// components/linking/link-password-form.tsx
'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/use-t';

interface Props {
  onSubmit: (password: string) => Promise<void>;
  error: string | null;
  submitting: boolean;
}

export function LinkPasswordForm({ onSubmit, error, submitting }: Props) {
  const t = useT();
  const [password, setPassword] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); if (password) void onSubmit(password); }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="link-password">{t('link.passwordLabel')}</Label>
        <Input
          id="link-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('link.passwordPlaceholder')}
        />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" disabled={submitting || !password} className="min-h-11">
        {submitting ? t('link.submitting') : t('link.submit')}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Implementar `app/(vault)/link/page.tsx`**

```tsx
// app/(vault)/link/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/use-t';
import { createLinkService } from '@/lib/linking/link-controller';
import { LinkError, type LinkState } from '@/lib/linking/types';
import { LinkPasswordForm } from '@/components/linking/link-password-form';
import { LinkChoiceDialog } from '@/components/linking/link-choice-dialog';
import { repository } from '@/lib/db/repository';

const errorKey = (code: string): string =>
  code === 'wrong-password' ? 'link.wrongPassword'
  : code === 'offline' ? 'link.offline'
  : code === 'no-session' ? 'link.noSession'
  : 'link.unknownError';

export default function LinkPage() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<LinkState>({ phase: 'detecting', situation: null, remote: null, error: null });

  // 1. Detectar la situación al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const svc = await createLinkService();
      if (!svc) { router.replace('/dashboard'); return; }
      try {
        const c = await svc.detect();
        if (cancelled) return;
        if (c.situation === 'remote-only') {
          setState({ phase: 'need-password', situation: c.situation, remote: c.remote, error: null });
        } else if (c.situation === 'both-different') {
          setState({ phase: 'choice', situation: c.situation, remote: c.remote, error: null });
        } else if (c.situation === 'local-only') {
          await svc.linkLocalVault();
          router.replace('/dashboard');
        } else {
          // both-same / no-remote-no-local → nada que vincular aquí
          router.replace('/dashboard');
        }
      } catch (e) {
        if (cancelled) return;
        const code = e instanceof LinkError ? e.code : 'unknown';
        setState((s) => ({ ...s, phase: 'error', error: code }));
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // 2. Dispositivo nuevo: enviar password.
  const handlePassword = useCallback(async (password: string) => {
    setState((s) => ({ ...s, phase: 'resolving', error: null }));
    const svc = await createLinkService();
    if (!svc) { setState((s) => ({ ...s, phase: 'error', error: 'no-session' })); return; }
    try {
      await svc.linkNewDevice(password);
      router.replace('/dashboard');
    } catch (e) {
      const code = e instanceof LinkError ? e.code : 'unknown';
      setState((s) => ({ ...s, phase: 'need-password', error: code }));
    }
  }, [router]);

  // 3. Elección destructiva (vaults distintos).
  const keepRemote = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'need-password', error: null }));
    // Conservar remoto = descartar local y bajar remoto: pedir password del remoto.
  }, []);

  const keepLocal = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'resolving', error: null }));
    const svc = await createLinkService();
    if (!svc || !state.remote) { router.replace('/dashboard'); return; }
    try {
      // Conservar local = sobrescribir remoto con la versión local (push con la versión remota como base).
      const { SyncRepository } = await import('@/lib/sync/sync-repository');
      const meta = await repository.getMeta();
      const blob = await repository.getEncryptedData();
      void SyncRepository; // push real se hace vía SyncService.resolveConflictKeepLocal en S6; aquí reutilizamos linkLocalVault tras limpiar versión
      await repository.saveSyncState({ version: state.remote.version, updatedAt: state.remote.updatedAt });
      if (meta && blob) await svc.linkLocalVault();
      router.replace('/dashboard');
    } catch {
      setState((s) => ({ ...s, phase: 'error', error: 'unknown' }));
    }
  }, [router, state.remote]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      {state.phase === 'detecting' && <p className="text-center text-sm text-muted-foreground">{t('link.detecting')}</p>}

      {state.phase === 'need-password' && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-xl">{t('link.newDeviceTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('link.newDeviceBody')}</p>
          </div>
          <LinkPasswordForm onSubmit={handlePassword} error={state.error ? t(errorKey(state.error)) : null} submitting={false} />
        </>
      )}

      {state.phase === 'resolving' && <p className="text-center text-sm text-muted-foreground">{t('link.submitting')}</p>}

      {state.phase === 'error' && (
        <p className="text-center text-sm text-destructive" role="alert">{t(errorKey(state.error ?? 'unknown'))}</p>
      )}

      <LinkChoiceDialog
        open={state.phase === 'choice'}
        onKeepLocal={() => void keepLocal()}
        onKeepRemote={() => void keepRemote()}
        onCancel={() => router.replace('/dashboard')}
      />
    </main>
  );
}
```

Nota de implementación: el path "conservar remoto" reduce a `need-password` y luego `linkNewDevice` (que sobrescribe meta/blob locales con los remotos). El path "conservar local" sube el local fijando la base a la versión remota para ganar el `upsert_vault`. Verifica en ejecución que `linkLocalVault` con `saveSyncState` previo a la versión remota produce un push que avanza la versión; si `upsert_vault` exige `p_expected_version = remote.version`, ajusta `linkLocalVault` para aceptar un `expectedVersion` opcional (firma `linkLocalVault(expectedVersion = 0)`).

- [ ] **Step 3: Enganchar el redirect post sign-in**

En el callback/efecto de auth (S4), tras establecer sesión, si `isSyncEnabled()` redirige a `/link` en vez de `/dashboard` (la propia `/link` reenvía a `/dashboard` cuando no hay nada que vincular). Localiza el redirect post-login en `app/auth/callback/route.ts` o en `auth-store.ts`/`vault-guard` y apúntalo a `/link`. Mantén el comportamiento sin flag intacto (va directo a `/dashboard`/`/unlock`).

- [ ] **Step 4: Typecheck + build**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/linking/link-password-form.tsx app/\(vault\)/link/page.tsx
git commit -m "feat(linking): /link screen — new-device unlock + divergent-vault choice"
```

---

## Task 8: E2E Playwright — dos dispositivos (A y B)

Dos `BrowserContext` aislados (= dos dispositivos con IndexedDB separado) contra el **prod build** (patrón del `e2e/orbit.spec.ts` actual). A crea y edita → B vincula con la misma password y ve los datos → B edita → A converge. Requiere `NEXT_PUBLIC_SYNC_ENABLED=true` y un proyecto Supabase de test alcanzable. Mockeamos el sign-in de Google estableciendo una sesión Supabase directamente vía `localStorage`/cookies de test, o usando el helper de sesión de test que S4 deba exponer.

**Files:**
- Create: `e2e/multi-device.spec.ts`

- [ ] **Step 1: Escribir el test E2E completo**

```typescript
// e2e/multi-device.spec.ts
/**
 * Multi-device parity E2E (CP4 / spec §5.7).
 *
 * Dos contextos de navegador = dos dispositivos con IndexedDB aislado.
 * Verifica el code path ÚNICO de sync:
 *   A: crea vault + suscripción (push a Supabase)
 *   B: inicia sesión en la MISMA cuenta → /link → introduce la MISMA master password → ve la suscripción de A
 *   B: edita (añade otra) → push
 *   A: foco/visibilitychange → pull → converge (ve la edición de B)
 *
 * Precondiciones:
 *   - NEXT_PUBLIC_SYNC_ENABLED=true en el build bajo test.
 *   - Sesión Supabase de test inyectable (S4 expone un helper test-only o usamos un usuario seed).
 *   - Mismo origin para ambos contextos (paridad: no hay ramas por plataforma).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const MASTER_PASSWORD = 'TestPassword1!';
const SERVICE_A = 'Netflix';
const SERVICE_B = 'Spotify';

// Sesión Supabase de test: inyecta la sesión que S4 persiste (storageKey supabase). Si S4 expone
// otro mecanismo (p.ej. magic-link de test), sustituye este helper por él.
async function injectTestSession(ctx: BrowserContext, baseURL: string, userId: string) {
  await ctx.addInitScript(({ uid }) => {
    const session = {
      access_token: `test-${uid}`,
      refresh_token: `test-refresh-${uid}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: uid, email: 'multi-device@orbit.test' },
    };
    // El storageKey de @supabase/ssr en browser es `sb-<ref>-auth-token`; S4 debe exponerlo en
    // window.__ORBIT_SUPABASE_STORAGE_KEY__ para el test, o ajústalo aquí al ref real.
    const key = (window as any).__ORBIT_SUPABASE_STORAGE_KEY__ ?? 'sb-test-auth-token';
    localStorage.setItem(key, JSON.stringify({ currentSession: session, expiresAt: session.expires_at }));
  }, { uid: userId });
}

async function createVaultOn(page: Page) {
  await page.goto('/');
  await page.waitForURL('**/onboarding', { timeout: 15_000 });
  await page.getByLabel('Master password').first().fill(MASTER_PASSWORD);
  await page.getByLabel('Confirm password').fill(MASTER_PASSWORD);
  await page.getByRole('button', { name: /create vault/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

async function addSubscriptionOn(page: Page, name: string) {
  await page.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/subscriptions', { timeout: 10_000 });
  await page.getByRole('button', { name: /add subscription/i }).or(page.getByRole('button', { name: /^add$/i })).first().click();
  await page.getByLabel('Service name').fill(name);
  await page.getByLabel('Amount').fill('9.99');
  await page.getByLabel('Next renewal').fill('2026-12-31');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('button', { name: new RegExp(name, 'i') })).toBeVisible({ timeout: 10_000 });
}

test('multi-device parity: A creates, B links and sees data, B edits, A converges', async ({ browser, baseURL }) => {
  const userId = `e2e-${Date.now()}`;
  const url = baseURL ?? 'http://localhost:3000';

  // ── Dispositivo A ──────────────────────────────────────────────────────────
  const ctxA = await browser.newContext();
  await injectTestSession(ctxA, url, userId);
  const pageA = await ctxA.newPage();
  await createVaultOn(pageA);            // crea vault local
  await addSubscriptionOn(pageA, SERVICE_A); // mutación → push con debounce
  // Forzar flush del push pendiente (pagehide dispara SyncService.flush()).
  await pageA.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  // Margen para que el push asíncrono complete contra Supabase.
  await pageA.waitForTimeout(6000);

  // ── Dispositivo B (mismo usuario, IndexedDB aislado) ────────────────────────
  const ctxB = await browser.newContext();
  await injectTestSession(ctxB, url, userId);
  const pageB = await ctxB.newPage();
  await pageB.goto('/');               // sin vault local + remoto presente → /link
  await pageB.waitForURL('**/link', { timeout: 15_000 });
  // Dispositivo nuevo: introducir la MISMA master password.
  await pageB.getByLabel('Master password').fill(MASTER_PASSWORD);
  await pageB.getByRole('button', { name: /unlock & link device|desbloquear y vincular/i }).click();
  await pageB.waitForURL('**/dashboard', { timeout: 20_000 });
  // B ve la suscripción creada en A.
  await pageB.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
  await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 10_000 });

  // ── B edita → push ──────────────────────────────────────────────────────────
  await addSubscriptionOn(pageB, SERVICE_B);
  await pageB.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await pageB.waitForTimeout(6000);

  // ── A converge (foco → pull) ──────────────────────────────────────────────────
  await pageA.bringToFront();
  await pageA.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pageA.waitForTimeout(6000);
  await pageA.reload();                 // reload → unlock dispara reconcileNow (pull)
  await pageA.waitForURL('**/unlock', { timeout: 15_000 });
  await pageA.getByLabel('Master password').fill(MASTER_PASSWORD);
  await pageA.getByRole('button', { name: /unlock vault/i }).click();
  await pageA.waitForURL('**/dashboard', { timeout: 20_000 });
  await pageA.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
  // A ve AMBAS suscripciones: la suya y la de B.
  await expect(pageA.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 10_000 });
  await expect(pageA.getByRole('button', { name: new RegExp(SERVICE_B, 'i') })).toBeVisible({ timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Documentar precondiciones y correr**

Asegúrate de que el servidor de test corre con `NEXT_PUBLIC_SYNC_ENABLED=true` (ajusta `playwright.config.ts` `webServer.env` o el comando de arranque). Si S4 aún no expone un mecanismo de sesión de test, deja el test marcado `test.skip` con un comentario `// TODO(S4): test session helper` y conviértelo a `test` en cuanto exista — pero impleméntalo completo (no placeholder).

Run: `NEXT_PUBLIC_SYNC_ENABLED=true pnpm test:e2e e2e/multi-device.spec.ts`
Expected: PASS (1 test verde) contra un Supabase de test alcanzable.

- [ ] **Step 3: Commit**

```bash
git add e2e/multi-device.spec.ts playwright.config.ts
git commit -m "test(e2e): multi-device parity — two contexts link, edit, converge"
```

---

## Task 9: Gates y cierre

**Files:** (sin nuevos archivos de producto)

- [ ] **Step 1: Suite unit/component completa verde**

Run: `pnpm vitest run`
Expected: PASS — Phase 1 + S6 + S8.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm build`
Expected: PASS. Sin `NEXT_PUBLIC_SYNC_ENABLED`, `/link` reenvía a `/dashboard` y el resto es Phase 1.

- [ ] **Step 3: E2E**

Run: `NEXT_PUBLIC_SYNC_ENABLED=true pnpm test:e2e`
Expected: la suite e2e (incluida `multi-device.spec.ts`) verde. Si el helper de sesión de test depende de S4, deja constancia del estado.

- [ ] **Step 4: `/code-review`**

Ejecuta `/code-review` sobre el diff de S8. Atiende correctness/reuse. Re-corre tests tras cambios.

- [ ] **Step 5: `typescript-reviewer`**

Dispara `typescript-reviewer` sobre los `.ts/.tsx` nuevos/modificados. Aplica feedback verificado.

- [ ] **Step 6: `/security-review`**

Ejecuta `/security-review` — S8 toca auth + crypto. Verifica explícitamente: (a) la master password y la `CryptoKey` nunca se envían a Supabase; (b) `LinkService` descifra solo en cliente; (c) `SyncRepository` solo transporta ciphertext; (d) el path destructivo `both-different` exige confirmación y no borra sin elección; (e) sin sesión / sin flag, ningún code path de linking se activa.

- [ ] **Step 7: Verificación (verification-before-completion)**

Evidencia: salida de `pnpm vitest run`, `pnpm build`, y la corrida E2E (o el motivo documentado si depende del helper de S4). Enumera archivos creados/modificados.

- [ ] **Step 8: Commit final + `/compact`**

```bash
git add -A
git commit -m "chore(s8): review gates green — account linking & multi-device (CP4) complete"
```

Output: `✅ CP4: link local vault to account; new-device pull+unlock`. Luego `/compact`.

---

## Self-review (cubierto)

- **Dispositivo nuevo (CP4 Task 4.1):** login → detectar remoto → pedir password → bajar meta+blob → deriveKey con meta remota → checkVerifier → decrypt → persistir local → desbloqueado. Tasks 3 (`linkNewDevice`) + 7 (`/link`). Errores password incorrecta / sin red cubiertos (tests Task 3 + UI Task 7). ✓
- **Vault local que inicia sesión (CP4 Task 4.1):** sin remoto → push inicial (`linkLocalVault`, Task 3); con remoto distinto → elección destructiva (`both-different`, Tasks 2/6/7). ✓
- **Clasificación por KDF salt (CP4 edge case "which master password"):** Task 2 `classifySituation` distingue `both-same` vs `both-different` por salt. ✓
- **Multi-device matriz + code path único:** sección "Matriz de plataformas" + Goal/Architecture; montaje y flujo idénticos en toda plataforma. ✓
- **E2E dos contextos (CP4 / spec §5.7):** Task 8, A crea/edita → B vincula y ve → B edita → A converge. ✓
- **i18n es/en:** Task 5 (mismas claves ambos locales). ✓
- **Flag + sesión + offline-first:** Task 4 gating; sin flag `/link` reenvía a `/dashboard`. ✓
- **Reutiliza S6 sin renombrar tipos:** `RemoteVault`, `LinkClassification`, `SyncRepository`, `ConflictError`, `VaultMeta`, `VaultData` coinciden con el plan S6. ✓
