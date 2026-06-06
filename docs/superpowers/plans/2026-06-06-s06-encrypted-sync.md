# Orbit S6 — Encrypted Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Investiga cada librería con la **context7 MCP** antes de escribir código, y maneja Supabase con la **Supabase CLI**/**Supabase MCP** — nunca por la web UI. SIEMPRE `pnpm`.

**Goal:** Construir el motor de sincronización cifrada de extremo a extremo de Orbit (CP3 del `phase-2-plan.md`): una capa de Sync que sube/baja el **mismo blob ya cifrado** del vault a Supabase con concurrencia optimista por versión, de modo que la misma cuenta vea el mismo vault en **móvil (PWA iOS/Android), navegador móvil, web y desktop** — un único code path de sync, sin ramas por plataforma.

**Architecture:** La frontera de cifrado no se mueve. `vaultService` sigue produciendo el `encrypted_blob` (AES-256-GCM) y `VaultMeta` (KDF Argon2id + verifier); el código de sync transporta esa cadena **opaca** hacia/desde la tabla `public.vaults` y nunca ve plaintext ni `CryptoKey`. La sincronización es local-first: Dexie sigue siendo la fuente de verdad de trabajo y la nube es un espejo cifrado. El cerebro es `reconcile()` (función PURA: compara versión local vs remota → `push | pull | conflict | noop`), `sync-repository.ts` hace la I/O con Supabase (RPC `upsert_vault` con `p_expected_version`, mapeando el errcode `40001` a `ConflictError` tipado), y `sync-service.ts` orquesta (debounce tras cada `persistVault`, pull al unlock + `visibilitychange`, estado observable en un store Zustand). Todo va detrás del flag `NEXT_PUBLIC_SYNC_ENABLED` y solo actúa si hay sesión Supabase; sin sesión o sin red el comportamiento es idéntico a Phase 1 (offline-first intacto).

**Tech Stack:** Next.js 16.2.7 (App Router) · TypeScript · Dexie/IndexedDB · Zustand (`zustand/vanilla` + `useStore`) · `@supabase/supabase-js` + `@supabase/ssr` (clientes creados en S2/S4 en `lib/supabase/`) · WebCrypto AES-GCM + Argon2id (hash-wasm) · Vitest (`pnpm vitest run`) · Playwright.

**Supuestos de sesiones previas (NO crear aquí):**
- `lib/supabase/client.ts` exporta `createClient()` → `SupabaseClient` (browser, `@supabase/ssr createBrowserClient`). Creado en S2/S4.
- `lib/supabase/server.ts` y `lib/supabase/database.types.ts` (tipos generados, incluye tabla `vaults` y la RPC `upsert_vault`). Creados en S2/S4.
- La migración `supabase/migrations/0001_init.sql` con `public.vaults`, RLS y la función `public.upsert_vault(p_meta text, p_blob text, p_expected_version bigint)` que lanza `raise exception 'version_conflict' using errcode = '40001'` en conflicto. Aplicada en CP1 (S2).
- `lib/store/auth-store.ts` con `authStore` que expone la sesión Supabase (`session`/`user`). Creado en S4. **Si en ejecución resulta que no existe**, este plan incluye un fallback mínimo en Task 6 (helper `getSupabaseSession()`); úsalo solo en ese caso.

---

## File structure (S6 — adiciones; archivos de Phase 1 intactos)

```
orbit/
├─ lib/
│  ├─ sync/
│  │  ├─ types.ts                 # SyncState, SyncSnapshot, ReconcileInput/Result, ConflictError, RemoteVault
│  │  ├─ reconcile.ts             # PURE: reconcile(input) → ReconcileResult (sin I/O, sin crypto)
│  │  ├─ sync-repository.ts       # I/O Supabase: pullVault() / pushVault(meta, blob, expectedVersion)
│  │  └─ sync-service.ts          # orquestación: reconcileNow(), debounce, listeners unlock/visibility
│  ├─ store/
│  │  └─ sync-store.ts            # Zustand: { status, lastSyncedAt, conflict } + useSyncStore selector
│  └─ db/
│     ├─ database.ts (MOD)        # +tabla `sync` (versión local) — version(2) de Dexie
│     └─ repository.ts (MOD)      # +getSyncState()/saveSyncState()
├─ components/
│  └─ sync/
│     └─ conflict-dialog.tsx      # diálogo "este dispositivo / el otro dispositivo" con timestamps
├─ lib/i18n/dict.ts (MOD)         # +claves sync.* en en y es
└─ tests/
   └─ sync/
      ├─ reconcile.test.ts        # exhaustivo de reconcile (TDD primero)
      ├─ sync-repository.test.ts  # supabase mockeado; assert "solo ciphertext"
      └─ sync-service.test.ts     # orquestación con repo + reconcile mockeados
```

---

## Task 1: Tipos de sync compartidos

**Files:**
- Create: `lib/sync/types.ts`

- [ ] **Step 1: Escribir el módulo de tipos completo**

Estos tipos son el contrato compartido entre `reconcile`, `sync-repository`, `sync-service`, `sync-store` y el plan S8. Nombres estables: no renombrar en tasks posteriores.

```typescript
// lib/sync/types.ts
import type { VaultMeta } from '@/lib/types';

/** Estado observable de la sincronización para la UI. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict' | 'disabled';

/** Fila remota tal como vive en public.vaults — ciphertext opaco + meta + versión. */
export interface RemoteVault {
  encryptedMeta: string;   // JSON.stringify(VaultMeta) — opaco para el servidor
  encryptedBlob: string;   // AES-256-GCM ciphertext de VaultData — opaco
  version: number;         // entero monotónico controlado por upsert_vault()
  updatedAt: string;       // ISO 8601 (timestamptz del servidor)
}

/** Lado local de la comparación (no incluye claves ni plaintext). */
export interface LocalVaultRef {
  version: number;         // versión local persistida en Dexie (0 si nunca se sincronizó)
  updatedAt: string;       // ISO 8601 de la última mutación local persistida
}

/** Entrada de la función pura de reconciliación. `remote` null = no hay fila remota. */
export interface ReconcileInput {
  local: LocalVaultRef;
  remote: RemoteVault | null;
}

/**
 * Resultado de reconcile():
 *  - 'noop'     versiones iguales, nada que hacer
 *  - 'push'     local por delante (o no hay remoto) → subir local
 *  - 'pull'     remoto por delante → bajar y aplicar remoto
 *  - 'conflict' ambos divergieron desde el ancestro común → pedir al usuario
 */
export type ReconcileAction = 'noop' | 'push' | 'pull' | 'conflict';

export interface ReconcileResult {
  action: ReconcileAction;
  reason: string;          // explicación legible para logs/tests
}

/** Snapshot que el sync-store expone a la UI. */
export interface SyncSnapshot {
  status: SyncStatus;
  lastSyncedAt: string | null;
  conflict: ConflictInfo | null;
}

/** Info mostrada en el diálogo de conflicto. */
export interface ConflictInfo {
  localUpdatedAt: string;  // ISO 8601 — "este dispositivo"
  remoteUpdatedAt: string; // ISO 8601 — "el otro dispositivo"
  remote: RemoteVault;     // se conserva para poder aplicar "usar remoto" sin re-pull
}

/** Error tipado para el conflicto de versión (errcode 40001 de upsert_vault). */
export class ConflictError extends Error {
  readonly code = 'version_conflict' as const;
  constructor(message = 'Vault version conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Helper de narrowing usado por sync-service y sync-repository. */
export function isConflictError(e: unknown): e is ConflictError {
  return e instanceof ConflictError || (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'version_conflict');
}

/** Re-export para evitar import circular en consumidores. */
export type { VaultMeta };
```

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS (sin errores en `lib/sync/types.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/sync/types.ts
git commit -m "feat(sync): shared sync types (reconcile contract + ConflictError)"
```

---

## Task 2: `reconcile()` — función PURA (TDD estricto)

Es el cerebro de la sincronización. Cero I/O, cero crypto. La regla de conflicto: el cliente guarda la `version` remota que descargó por última vez (su "base"). Si la versión remota actual avanzó respecto a la base **y** el local también cambió respecto a esa base, es conflicto real. Modelamos esto comparando `local.version` (= última versión remota conocida y aceptada por el cliente; se incrementa solo al hacer push/pull con éxito) contra `remote.version`:

- `remote === null` → `push` (subida inicial).
- `local.version === 0` y hay remoto → `pull` (dispositivo nuevo: no tiene base, baja todo).
- `remote.version === local.version` → comparar `updatedAt`: si el local es más nuevo, hubo mutación local sin sincronizar → `push`; si son iguales → `noop`.
- `remote.version > local.version` y el local **no** tiene cambios sin sincronizar (`local.updatedAt <= remote.updatedAt conocido`)… no podemos saber el ancestro sin más estado, así que: `remote.version > local.version` y local sin mutación pendiente → `pull`; con mutación pendiente → `conflict`.
- `local.version > remote.version` → no debería ocurrir (servidor es autoridad de versión); tratar como `push` defensivo.

La "mutación pendiente local" se representa con `local.updatedAt > base`; como `base` no se transporta explícitamente, usamos la convención: **el sync-service fija `local.version` = versión remota aceptada y `local.updatedAt` = timestamp de esa aceptación tras cada pull/push exitoso. Cualquier mutación local posterior actualiza `local.updatedAt` por encima de ese valor.** Por tanto `local.updatedAt > remote.updatedAt` de la última base ⇒ hay cambios locales pendientes. En `reconcile` recibimos el `remote` actual, así que comparamos contra él.

**Files:**
- Create: `tests/sync/reconcile.test.ts`
- Create: `lib/sync/reconcile.ts`

- [ ] **Step 1: Escribir el test completo PRIMERO**

```typescript
// tests/sync/reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { reconcile } from '@/lib/sync/reconcile';
import type { RemoteVault } from '@/lib/sync/types';

const remoteAt = (version: number, updatedAt: string): RemoteVault => ({
  encryptedMeta: 'META',
  encryptedBlob: 'BLOB',
  version,
  updatedAt,
});

describe('reconcile (pure)', () => {
  it('no remote → push (initial upload)', () => {
    const r = reconcile({ local: { version: 0, updatedAt: '2026-06-06T10:00:00.000Z' }, remote: null });
    expect(r.action).toBe('push');
  });

  it('local never synced (version 0) but remote exists → pull (new device)', () => {
    const r = reconcile({
      local: { version: 0, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote: remoteAt(5, '2026-06-06T09:00:00.000Z'),
    });
    expect(r.action).toBe('pull');
  });

  it('equal versions, equal timestamps → noop', () => {
    const ts = '2026-06-06T10:00:00.000Z';
    const r = reconcile({ local: { version: 3, updatedAt: ts }, remote: remoteAt(3, ts) });
    expect(r.action).toBe('noop');
  });

  it('equal versions, local newer than remote → push (local ahead, pending mutation)', () => {
    const r = reconcile({
      local: { version: 3, updatedAt: '2026-06-06T10:05:00.000Z' },
      remote: remoteAt(3, '2026-06-06T10:00:00.000Z'),
    });
    expect(r.action).toBe('push');
  });

  it('remote version ahead, no local pending mutation → pull (remote ahead)', () => {
    // local aceptó la versión 3 en t=10:00; remoto ya va por 4 en t=10:03; local no tocó nada después
    const r = reconcile({
      local: { version: 3, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote: remoteAt(4, '2026-06-06T10:03:00.000Z'),
    });
    expect(r.action).toBe('pull');
  });

  it('remote version ahead AND local has pending mutation → conflict (both changed)', () => {
    // local aceptó v3 en 10:00, luego mutó local a 10:07 (pending); remoto avanzó a v4 en 10:03
    const r = reconcile({
      local: { version: 3, updatedAt: '2026-06-06T10:07:00.000Z' },
      remote: remoteAt(4, '2026-06-06T10:03:00.000Z'),
    });
    expect(r.action).toBe('conflict');
  });

  it('local version greater than remote (defensive) → push', () => {
    const r = reconcile({
      local: { version: 5, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote: remoteAt(4, '2026-06-06T09:00:00.000Z'),
    });
    expect(r.action).toBe('push');
  });

  it('every result includes a non-empty reason', () => {
    const r = reconcile({ local: { version: 0, updatedAt: '2026-06-06T10:00:00.000Z' }, remote: null });
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/reconcile"` (el módulo aún no existe).

- [ ] **Step 3: Implementar `reconcile()` completo**

```typescript
// lib/sync/reconcile.ts
import type { ReconcileInput, ReconcileResult } from './types';

/**
 * Decide la acción de sincronización comparando el estado local conocido
 * contra la fila remota actual. PURA: sin I/O, sin crypto, determinista.
 *
 * Convención de versiones (fijada por sync-service):
 *  - local.version = última versión remota que el cliente aceptó (push/pull OK). 0 = nunca sincronizó.
 *  - local.updatedAt = timestamp de la última MUTACIÓN local persistida. Si es mayor que el
 *    updatedAt remoto de la base aceptada, hay cambios locales pendientes de subir.
 */
export function reconcile({ local, remote }: ReconcileInput): ReconcileResult {
  if (remote === null) {
    return { action: 'push', reason: 'no remote row: initial upload' };
  }

  if (local.version === 0) {
    return { action: 'pull', reason: 'local never synced but remote exists: pull to adopt remote' };
  }

  if (remote.version === local.version) {
    if (Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) {
      return { action: 'push', reason: 'same version, local mutated after last sync: push local' };
    }
    return { action: 'noop', reason: 'same version, no local changes: up to date' };
  }

  if (remote.version > local.version) {
    const localHasPendingMutation = Date.parse(local.updatedAt) > Date.parse(remote.updatedAt);
    if (localHasPendingMutation) {
      return { action: 'conflict', reason: 'remote advanced AND local has unsynced changes: conflict' };
    }
    return { action: 'pull', reason: 'remote advanced, no local changes: pull remote' };
  }

  // local.version > remote.version — el servidor es la autoridad de versión; defensivo.
  return { action: 'push', reason: 'local version ahead of remote (defensive): push local' };
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/reconcile.test.ts`
Expected: PASS (8 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/reconcile.ts tests/sync/reconcile.test.ts
git commit -m "feat(sync): pure reconcile() with exhaustive TDD (push/pull/conflict/noop)"
```

---

## Task 3: Persistir versión local en Dexie

El cliente necesita guardar `LocalVaultRef` (versión remota aceptada + timestamp) junto al blob para la concurrencia optimista. Añadimos una tabla `sync` (versión 2 del schema Dexie) y métodos al repository.

**Files:**
- Modify: `lib/db/database.ts`
- Modify: `lib/db/repository.ts`
- Create: `tests/sync/repository-sync-state.test.ts`

- [ ] **Step 1: Escribir el test PRIMERO**

```typescript
// tests/sync/repository-sync-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { repository } from '@/lib/db/repository';
import { db } from '@/lib/db/database';

describe('repository sync state', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('returns undefined when no sync state stored', async () => {
    expect(await repository.getSyncState()).toBeUndefined();
  });

  it('persists and reads back local vault ref', async () => {
    const ref = { version: 4, updatedAt: '2026-06-06T10:00:00.000Z' };
    await repository.saveSyncState(ref);
    expect(await repository.getSyncState()).toEqual(ref);
  });

  it('overwrites previous sync state', async () => {
    await repository.saveSyncState({ version: 1, updatedAt: '2026-06-06T09:00:00.000Z' });
    await repository.saveSyncState({ version: 2, updatedAt: '2026-06-06T09:30:00.000Z' });
    expect((await repository.getSyncState())?.version).toBe(2);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/repository-sync-state.test.ts`
Expected: FAIL — `repository.getSyncState is not a function`.

- [ ] **Step 3: Añadir la tabla `sync` a Dexie (versión 2)**

```typescript
// lib/db/database.ts
import Dexie, { type Table } from 'dexie';
import type { VaultMeta, Settings, FxRatesCache } from '@/lib/types';
import type { LocalVaultRef } from '@/lib/sync/types';

interface KeyedRow<T> { key: string; value: T; }

export class OrbitDB extends Dexie {
  meta!: Table<KeyedRow<VaultMeta>, string>;
  blob!: Table<KeyedRow<string>, string>;      // encrypted VaultData
  settings!: Table<KeyedRow<Settings>, string>; // plaintext (no secrets)
  fx!: Table<KeyedRow<FxRatesCache>, string>;   // plaintext
  sync!: Table<KeyedRow<LocalVaultRef>, string>; // local sync ref (version + updatedAt)

  constructor() {
    super('orbit');
    this.version(1).stores({ meta: 'key', blob: 'key', settings: 'key', fx: 'key' });
    this.version(2).stores({ meta: 'key', blob: 'key', settings: 'key', fx: 'key', sync: 'key' });
  }
}

export const db = new OrbitDB();
```

- [ ] **Step 4: Añadir métodos al repository**

```typescript
// lib/db/repository.ts — añadir import y métodos
import type { LocalVaultRef } from '@/lib/sync/types';

const SYNC_KEY = 'sync';
```

Añade dentro del objeto `repository` (junto a los demás métodos, antes de `wipeVault`):

```typescript
  async getSyncState(): Promise<LocalVaultRef | undefined> {
    return (await db.sync.get(SYNC_KEY))?.value;
  },
  async saveSyncState(ref: LocalVaultRef): Promise<void> {
    await db.sync.put({ key: SYNC_KEY, value: ref });
  },
```

Y extiende `wipeVault` para limpiar también la tabla `sync`:

```typescript
  async wipeVault(): Promise<void> {
    await db.transaction('rw', db.meta, db.blob, db.settings, db.fx, db.sync, async () => {
      await Promise.all([db.meta.clear(), db.blob.clear(), db.settings.clear(), db.fx.clear(), db.sync.clear()]);
    });
  },
```

- [ ] **Step 5: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/repository-sync-state.test.ts`
Expected: PASS (3 tests verdes).

- [ ] **Step 6: Verificar que no se rompió nada en db/repository**

Run: `pnpm vitest run tests/db tests/services`
Expected: PASS (suites existentes siguen verdes).

- [ ] **Step 7: Commit**

```bash
git add lib/db/database.ts lib/db/repository.ts tests/sync/repository-sync-state.test.ts
git commit -m "feat(sync): persist local vault version ref in Dexie (schema v2)"
```

---

## Task 4: `sync-repository.ts` — I/O con Supabase (solo ciphertext)

Aísla toda la I/O con Supabase. **Nunca** descifra ni recibe `CryptoKey`: solo cadenas opacas. Mapea el errcode `40001` de `upsert_vault` a `ConflictError`.

**Files:**
- Create: `tests/sync/sync-repository.test.ts`
- Create: `lib/sync/sync-repository.ts`

- [ ] **Step 1: Escribir el test PRIMERO (supabase mockeado + assert "solo ciphertext")**

```typescript
// tests/sync/sync-repository.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncRepository } from '@/lib/sync/sync-repository';
import { ConflictError } from '@/lib/sync/types';

// Mock mínimo de SupabaseClient: solo lo que usa el repositorio.
function makeClient(opts: {
  selectResult?: { data: unknown; error: unknown };
  rpcResult?: { data: unknown; error: unknown };
}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? { data: null, error: null });
  const maybeSingle = vi.fn().mockResolvedValue(opts.selectResult ?? { data: null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from, rpc } as any, spies: { from, select, eq, maybeSingle, rpc } };
}

describe('SyncRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pullVault returns null when no remote row', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: null } });
    const repo = new SyncRepository(client, 'user-1');
    expect(await repo.pullVault()).toBeNull();
  });

  it('pullVault maps a remote row to RemoteVault', async () => {
    const { client } = makeClient({
      selectResult: {
        data: { encrypted_meta: 'META', encrypted_blob: 'BLOB', version: 7, updated_at: '2026-06-06T10:00:00.000Z' },
        error: null,
      },
    });
    const repo = new SyncRepository(client, 'user-1');
    expect(await repo.pullVault()).toEqual({
      encryptedMeta: 'META', encryptedBlob: 'BLOB', version: 7, updatedAt: '2026-06-06T10:00:00.000Z',
    });
  });

  it('pullVault throws on a non-"no rows" supabase error', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: { code: '500', message: 'boom' } } });
    const repo = new SyncRepository(client, 'user-1');
    await expect(repo.pullVault()).rejects.toThrow(/boom/);
  });

  it('pushVault calls upsert_vault RPC with opaque ciphertext only', async () => {
    const { client, spies } = makeClient({
      rpcResult: {
        data: { encrypted_meta: 'META', encrypted_blob: 'BLOB', version: 2, updated_at: '2026-06-06T10:00:00.000Z' },
        error: null,
      },
    });
    const repo = new SyncRepository(client, 'user-1');
    const result = await repo.pushVault('META', 'BLOB', 1);

    expect(spies.rpc).toHaveBeenCalledWith('upsert_vault', {
      p_meta: 'META', p_blob: 'BLOB', p_expected_version: 1,
    });
    // Lo que se manda son strings opacas; ningún argumento es CryptoKey ni objeto plaintext.
    const [, args] = spies.rpc.mock.calls[0];
    for (const v of Object.values(args)) {
      expect(typeof v === 'string' || typeof v === 'number').toBe(true);
    }
    expect(result.version).toBe(2);
  });

  it('pushVault maps errcode 40001 to ConflictError', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { code: '40001', message: 'version_conflict' } },
    });
    const repo = new SyncRepository(client, 'user-1');
    await expect(repo.pushVault('META', 'BLOB', 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it('pushVault maps a "version_conflict" message to ConflictError even without code', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { code: 'P0001', message: 'version_conflict' } },
    });
    const repo = new SyncRepository(client, 'user-1');
    await expect(repo.pushVault('META', 'BLOB', 1)).rejects.toBeInstanceOf(ConflictError);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/sync-repository.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/sync-repository"`.

- [ ] **Step 3: Implementar `SyncRepository` completo**

```typescript
// lib/sync/sync-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConflictError, type RemoteVault } from './types';

/** Forma de la fila tal como la devuelve Postgres (snake_case). */
interface VaultRow {
  encrypted_meta: string;
  encrypted_blob: string;
  version: number;
  updated_at: string;
}

function rowToRemote(row: VaultRow): RemoteVault {
  return {
    encryptedMeta: row.encrypted_meta,
    encryptedBlob: row.encrypted_blob,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

/**
 * I/O con Supabase para el vault cifrado. Transporta SOLO ciphertext opaco
 * (encryptedMeta / encryptedBlob) y la versión. Nunca descifra ni ve CryptoKey.
 */
export class SyncRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  /** Devuelve la fila remota del usuario o null si aún no existe. */
  async pullVault(): Promise<RemoteVault | null> {
    const { data, error } = await this.client
      .from('vaults')
      .select('encrypted_meta, encrypted_blob, version, updated_at')
      .eq('user_id', this.userId)
      .maybeSingle();

    if (error) throw new Error(`pullVault failed: ${error.message}`);
    if (!data) return null;
    return rowToRemote(data as VaultRow);
  }

  /**
   * Sube el blob+meta cifrados vía la RPC upsert_vault con concurrencia optimista.
   * `expectedVersion` es la versión remota que el cliente cree vigente (0 = inserción inicial).
   * Mapea el errcode 40001 (o el mensaje 'version_conflict') a ConflictError tipado.
   */
  async pushVault(encryptedMeta: string, encryptedBlob: string, expectedVersion: number): Promise<RemoteVault> {
    const { data, error } = await this.client.rpc('upsert_vault', {
      p_meta: encryptedMeta,
      p_blob: encryptedBlob,
      p_expected_version: expectedVersion,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? '';
      if (code === '40001' || message.includes('version_conflict')) {
        throw new ConflictError();
      }
      throw new Error(`pushVault failed: ${message}`);
    }
    return rowToRemote(data as VaultRow);
  }
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/sync-repository.test.ts`
Expected: PASS (6 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/sync-repository.ts tests/sync/sync-repository.test.ts
git commit -m "feat(sync): SyncRepository (ciphertext-only I/O; 40001 → ConflictError)"
```

---

## Task 5: `sync-store.ts` — estado observable Zustand

Store pequeño y desacoplado de la UI, con binding `useSyncStore` (mismo patrón que `settings-store.ts`).

**Files:**
- Create: `tests/sync/sync-store.test.ts`
- Create: `lib/store/sync-store.ts`

- [ ] **Step 1: Escribir el test PRIMERO**

```typescript
// tests/sync/sync-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { syncStore } from '@/lib/store/sync-store';

describe('syncStore', () => {
  beforeEach(() => syncStore.getState().reset());

  it('starts idle with no conflict', () => {
    const s = syncStore.getState();
    expect(s.status).toBe('idle');
    expect(s.conflict).toBeNull();
    expect(s.lastSyncedAt).toBeNull();
  });

  it('setStatus updates status', () => {
    syncStore.getState().setStatus('syncing');
    expect(syncStore.getState().status).toBe('syncing');
  });

  it('markSynced sets idle + lastSyncedAt and clears conflict', () => {
    syncStore.getState().setConflict({
      localUpdatedAt: '2026-06-06T10:00:00.000Z',
      remoteUpdatedAt: '2026-06-06T10:05:00.000Z',
      remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 2, updatedAt: '2026-06-06T10:05:00.000Z' },
    });
    syncStore.getState().markSynced('2026-06-06T11:00:00.000Z');
    const s = syncStore.getState();
    expect(s.status).toBe('idle');
    expect(s.lastSyncedAt).toBe('2026-06-06T11:00:00.000Z');
    expect(s.conflict).toBeNull();
  });

  it('setConflict moves status to conflict and stores info', () => {
    const info = {
      localUpdatedAt: '2026-06-06T10:00:00.000Z',
      remoteUpdatedAt: '2026-06-06T10:05:00.000Z',
      remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 2, updatedAt: '2026-06-06T10:05:00.000Z' },
    };
    syncStore.getState().setConflict(info);
    expect(syncStore.getState().status).toBe('conflict');
    expect(syncStore.getState().conflict).toEqual(info);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/sync-store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/store/sync-store"`.

- [ ] **Step 3: Implementar `sync-store.ts`**

```typescript
// lib/store/sync-store.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ConflictInfo, SyncStatus } from '@/lib/sync/types';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  conflict: ConflictInfo | null;
  setStatus: (status: SyncStatus) => void;
  setConflict: (conflict: ConflictInfo) => void;
  clearConflict: () => void;
  markSynced: (at: string) => void;
  reset: () => void;
}

export const syncStore = createStore<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  conflict: null,
  setStatus: (status) => set({ status }),
  setConflict: (conflict) => set({ status: 'conflict', conflict }),
  clearConflict: () => set({ conflict: null }),
  markSynced: (at) => set({ status: 'idle', lastSyncedAt: at, conflict: null }),
  reset: () => set({ status: 'idle', lastSyncedAt: null, conflict: null }),
}));

/** React binding — use like: useSyncStore(s => s.status) */
export function useSyncStore<T>(selector: (state: SyncState) => T): T {
  return useStore(syncStore, selector);
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/sync-store.test.ts`
Expected: PASS (4 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/store/sync-store.ts tests/sync/sync-store.test.ts
git commit -m "feat(sync): observable sync store (idle/syncing/error/conflict)"
```

---

## Task 6: `sync-service.ts` — orquestación + debounce

Orquesta el ciclo: lee estado local de Dexie, hace `pullVault()`, corre `reconcile`, y según la acción hace push / aplica remoto / marca conflicto. El push tras mutaciones locales va **con debounce agresivo de 4000 ms** (decisión: el riesgo de cuota en Supabase Free es requests/Realtime, no DB; cada `persistVault` dispara una edición — agrupar ráfagas de tecleo/ediciones rápidas en una sola subida cada 4 s mantiene el tráfico bajo sin que el usuario perciba retraso, y deja margen amplio dentro del free tier; el flush inmediato en `lock`/`pagehide` evita perder la última edición). Pull al unlock, en `visibilitychange→visible` y al recuperar la red (`online`).

**Decisión sobre aplicar remoto (pull):** el sync-service **sí** necesita descifrar el blob remoto para hidratar el vault store local; eso ocurre con la `CryptoKey` ya presente en memoria (vault desbloqueado), reutilizando `vaultService`. La frontera ZK se mantiene: el descifrado es 100% cliente; `SyncRepository` (la capa que habla con el servidor) jamás ve la clave. Para mantener `sync-service` testeable sin crypto real, inyectamos un `applyRemote(remote)` y un `readLocal()` como dependencias.

**Files:**
- Create: `tests/sync/sync-service.test.ts`
- Create: `lib/sync/sync-service.ts`

- [ ] **Step 1: Escribir el test PRIMERO**

```typescript
// tests/sync/sync-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '@/lib/sync/sync-service';
import { syncStore } from '@/lib/store/sync-store';
import type { RemoteVault } from '@/lib/sync/types';

function makeDeps(over: Partial<{
  local: { meta: string; blob: string; version: number; updatedAt: string };
  remote: RemoteVault | null;
  pushResult: RemoteVault;
}> = {}) {
  const local = over.local ?? { meta: 'M', blob: 'B', version: 1, updatedAt: '2026-06-06T10:00:00.000Z' };
  const remote = over.remote ?? null;
  const pushResult = over.pushResult ?? { encryptedMeta: 'M', encryptedBlob: 'B', version: 2, updatedAt: '2026-06-06T10:01:00.000Z' };

  const repo = {
    pullVault: vi.fn().mockResolvedValue(remote),
    pushVault: vi.fn().mockResolvedValue(pushResult),
  };
  const readLocal = vi.fn().mockResolvedValue(local);
  const applyRemote = vi.fn().mockResolvedValue(undefined);
  const saveSyncState = vi.fn().mockResolvedValue(undefined);
  return { repo, readLocal, applyRemote, saveSyncState };
}

describe('SyncService.reconcileNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncStore.getState().reset();
  });

  it('pushes when there is no remote row (initial)', async () => {
    const d = makeDeps({ remote: null });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(d.repo.pushVault).toHaveBeenCalledWith('M', 'B', 1);
    expect(d.applyRemote).not.toHaveBeenCalled();
    expect(d.saveSyncState).toHaveBeenCalledWith({ version: 2, updatedAt: '2026-06-06T10:01:00.000Z' });
    expect(syncStore.getState().status).toBe('idle');
    expect(syncStore.getState().lastSyncedAt).not.toBeNull();
  });

  it('pulls and applies remote when remote is ahead', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:05:00.000Z' };
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: '2026-06-06T10:00:00.000Z' },
      remote,
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(d.applyRemote).toHaveBeenCalledWith(remote);
    expect(d.repo.pushVault).not.toHaveBeenCalled();
    expect(d.saveSyncState).toHaveBeenCalledWith({ version: 5, updatedAt: '2026-06-06T10:05:00.000Z' });
  });

  it('raises conflict (sets store) when both diverged', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' };
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: '2026-06-06T10:07:00.000Z' },
      remote,
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(syncStore.getState().status).toBe('conflict');
    expect(syncStore.getState().conflict?.remote).toEqual(remote);
    expect(d.repo.pushVault).not.toHaveBeenCalled();
    expect(d.applyRemote).not.toHaveBeenCalled();
  });

  it('noop when up to date', async () => {
    const ts = '2026-06-06T10:00:00.000Z';
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: ts },
      remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 3, updatedAt: ts },
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(d.repo.pushVault).not.toHaveBeenCalled();
    expect(d.applyRemote).not.toHaveBeenCalled();
  });

  it('sets error status when the repo throws (non-conflict)', async () => {
    const d = makeDeps({ remote: null });
    d.repo.pushVault.mockRejectedValueOnce(new Error('network down'));
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.reconcileNow();
    expect(syncStore.getState().status).toBe('error');
  });

  it('resolveConflictKeepLocal pushes local with remote version as expected', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' };
    const d = makeDeps({
      local: { meta: 'M', blob: 'B', version: 3, updatedAt: '2026-06-06T10:07:00.000Z' },
      remote,
      pushResult: { encryptedMeta: 'M', encryptedBlob: 'B', version: 6, updatedAt: '2026-06-06T10:08:00.000Z' },
    });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.resolveConflictKeepLocal(remote);
    expect(d.repo.pushVault).toHaveBeenCalledWith('M', 'B', 5);
    expect(syncStore.getState().conflict).toBeNull();
  });

  it('resolveConflictUseRemote applies remote and clears conflict', async () => {
    const remote: RemoteVault = { encryptedMeta: 'RM', encryptedBlob: 'RB', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' };
    const d = makeDeps({ remote });
    const svc = new SyncService(d.repo as any, d.readLocal, d.applyRemote, d.saveSyncState);
    await svc.resolveConflictUseRemote(remote);
    expect(d.applyRemote).toHaveBeenCalledWith(remote);
    expect(d.saveSyncState).toHaveBeenCalledWith({ version: 5, updatedAt: '2026-06-06T10:03:00.000Z' });
    expect(syncStore.getState().conflict).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/sync-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/sync-service"`.

- [ ] **Step 3: Implementar `sync-service.ts` completo**

```typescript
// lib/sync/sync-service.ts
import { reconcile } from './reconcile';
import { isConflictError, type RemoteVault, type LocalVaultRef } from './types';
import type { SyncRepository } from './sync-repository';
import { syncStore } from '@/lib/store/sync-store';

/** Snapshot local que el servicio necesita: ciphertext + versión + timestamp. */
export interface LocalSnapshot {
  meta: string;     // encryptedMeta (JSON.stringify(VaultMeta))
  blob: string;     // encryptedBlob (AES-GCM ciphertext)
  version: number;  // versión remota aceptada (de la tabla `sync`); 0 si nunca sincronizó
  updatedAt: string; // timestamp de la última mutación local persistida
}

export type ReadLocal = () => Promise<LocalSnapshot>;
export type ApplyRemote = (remote: RemoteVault) => Promise<void>;
export type SaveSyncState = (ref: LocalVaultRef) => Promise<void>;

/** Debounce agresivo del push tras mutaciones locales (ver justificación en el plan). */
export const PUSH_DEBOUNCE_MS = 4000;

export class SyncService {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repo: SyncRepository,
    private readonly readLocal: ReadLocal,
    private readonly applyRemote: ApplyRemote,
    private readonly saveSyncState: SaveSyncState,
  ) {}

  /** Ciclo completo de reconciliación. Idempotente; seguro de llamar en cualquier momento. */
  async reconcileNow(): Promise<void> {
    syncStore.getState().setStatus('syncing');
    try {
      const local = await this.readLocal();
      const remote = await this.repo.pullVault();
      const { action } = reconcile({
        local: { version: local.version, updatedAt: local.updatedAt },
        remote,
      });

      if (action === 'noop') {
        syncStore.getState().setStatus('idle');
        return;
      }
      if (action === 'push') {
        const saved = await this.repo.pushVault(local.meta, local.blob, local.version);
        await this.saveSyncState({ version: saved.version, updatedAt: saved.updatedAt });
        syncStore.getState().markSynced(new Date().toISOString());
        return;
      }
      if (action === 'pull') {
        // remote no puede ser null aquí (reconcile sólo devuelve 'pull' con remoto presente)
        await this.applyRemote(remote!);
        await this.saveSyncState({ version: remote!.version, updatedAt: remote!.updatedAt });
        syncStore.getState().markSynced(new Date().toISOString());
        return;
      }
      // conflict
      syncStore.getState().setConflict({
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote!.updatedAt,
        remote: remote!,
      });
    } catch (e) {
      if (isConflictError(e)) {
        // El push perdió la carrera: vuelve a pull para mostrar el remoto en el diálogo.
        const remote = await this.repo.pullVault().catch(() => null);
        const local = await this.readLocal();
        if (remote) {
          syncStore.getState().setConflict({
            localUpdatedAt: local.updatedAt,
            remoteUpdatedAt: remote.updatedAt,
            remote,
          });
          return;
        }
      }
      syncStore.getState().setStatus('error');
    }
  }

  /** Programa un push con debounce agresivo tras una mutación local. */
  schedulePush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconcileNow();
    }, PUSH_DEBOUNCE_MS);
  }

  /** Fuerza el flush inmediato del push pendiente (al lock / pagehide). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.reconcileNow();
    }
  }

  /** Conflicto → conservar lo de ESTE dispositivo: push local con la versión remota como base. */
  async resolveConflictKeepLocal(remote: RemoteVault): Promise<void> {
    syncStore.getState().setStatus('syncing');
    try {
      const local = await this.readLocal();
      const saved = await this.repo.pushVault(local.meta, local.blob, remote.version);
      await this.saveSyncState({ version: saved.version, updatedAt: saved.updatedAt });
      syncStore.getState().markSynced(new Date().toISOString());
    } catch {
      syncStore.getState().setStatus('error');
    }
  }

  /** Conflicto → usar lo del OTRO dispositivo: aplicar remoto y aceptar su versión. */
  async resolveConflictUseRemote(remote: RemoteVault): Promise<void> {
    syncStore.getState().setStatus('syncing');
    try {
      await this.applyRemote(remote);
      await this.saveSyncState({ version: remote.version, updatedAt: remote.updatedAt });
      syncStore.getState().markSynced(new Date().toISOString());
    } catch {
      syncStore.getState().setStatus('error');
    }
  }
}
```

- [ ] **Step 4: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/sync-service.test.ts`
Expected: PASS (7 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/sync-service.ts tests/sync/sync-service.test.ts
git commit -m "feat(sync): SyncService orchestration (debounced push, pull, conflict resolution)"
```

---

## Task 7: Wiring del servicio — fábrica, gating por flag/sesión y triggers

Conecta `SyncService` con `vaultService`/`vaultStore`/Supabase, **solo** si `NEXT_PUBLIC_SYNC_ENABLED === 'true'` y hay sesión. Sin flag, sin sesión o sin red → no se instancia nada: comportamiento Phase 1 intacto.

**Files:**
- Create: `lib/sync/sync-controller.ts`
- Modify: `lib/store/vault-store.ts`

- [ ] **Step 1: Escribir el test del controller PRIMERO**

```typescript
// tests/sync/sync-controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSyncEnabled, createSyncService } from '@/lib/sync/sync-controller';

describe('sync-controller gating', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('isSyncEnabled is false when flag is not "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', '');
    expect(isSyncEnabled()).toBe(false);
  });

  it('isSyncEnabled is true only when flag === "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', 'true');
    expect(isSyncEnabled()).toBe(true);
  });

  it('createSyncService returns null when sync disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_ENABLED', '');
    expect(await createSyncService()).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/sync-controller.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/sync-controller"`.

- [ ] **Step 3: Implementar `sync-controller.ts`**

`readLocal` lee Dexie + tabla `sync`; `applyRemote` descifra con la `CryptoKey` en memoria del `vaultStore` y re-hidrata (descifrado SOLO aquí, en cliente; nunca en `SyncRepository`).

```typescript
// lib/sync/sync-controller.ts
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import { decrypt } from '@/lib/crypto/vault';
import { SyncRepository } from './sync-repository';
import { SyncService, type LocalSnapshot } from './sync-service';
import type { RemoteVault, VaultMeta } from './types';
import type { VaultData } from '@/lib/types';

/** El flag de feature: la UI/engine de sync solo opera con NEXT_PUBLIC_SYNC_ENABLED === 'true'. */
export function isSyncEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true';
}

/**
 * Obtiene la sesión Supabase actual o null. Usa el authStore de S4 si existe;
 * si no, hace fallback al cliente browser. Devuelve { userId, client } o null.
 */
async function getSession(): Promise<{ userId: string; client: import('@supabase/supabase-js').SupabaseClient } | null> {
  // S4 crea lib/supabase/client.ts con createClient(). Si no existe, este import fallará en build;
  // S6 asume que S4 ya lo entregó (ver "Supuestos" en el header del plan).
  const { createClient } = await import('@/lib/supabase/client');
  const client = createClient();
  const { data } = await client.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  return { userId, client };
}

/** Lee el snapshot local (ciphertext + versión + timestamp) desde Dexie. */
async function readLocal(): Promise<LocalSnapshot> {
  const meta = await repository.getMeta();
  const blob = (await repository.getEncryptedData()) ?? '';
  const syncRef = await repository.getSyncState();
  return {
    meta: meta ? JSON.stringify(meta) : '',
    blob,
    version: syncRef?.version ?? 0,
    updatedAt: syncRef?.updatedAt ?? new Date(0).toISOString(),
  };
}

/**
 * Aplica el blob remoto: descifra con la CryptoKey en memoria y re-hidrata el vault store.
 * El descifrado ocurre SOLO aquí (cliente). SyncRepository jamás ve la clave.
 */
async function applyRemote(remote: RemoteVault): Promise<void> {
  const key = vaultStore.getState().key;
  if (!key) throw new Error('applyRemote: vault is locked, cannot decrypt remote blob');
  const meta = JSON.parse(remote.encryptedMeta) as VaultMeta;
  const data = JSON.parse(await decrypt(key, remote.encryptedBlob)) as VaultData;
  // Persistir meta+blob remotos localmente y cargar en memoria.
  await repository.createVault(meta, remote.encryptedBlob);
  vaultStore.setState({ data });
}

/**
 * Crea el SyncService cableado, o null si el sync está deshabilitado / sin sesión.
 * Llamar desde un efecto cliente (p.ej. tras unlock) cuando isSyncEnabled().
 */
export async function createSyncService(): Promise<SyncService | null> {
  if (!isSyncEnabled()) return null;
  const session = await getSession();
  if (!session) return null;
  const repo = new SyncRepository(session.client, session.userId);
  return new SyncService(repo, readLocal, applyRemote, (ref) => repository.saveSyncState(ref));
}
```

- [ ] **Step 4: Disparar push con debounce tras cada `persistVault` local**

En `lib/store/vault-store.ts`, la función `persist(get)` ya se llama tras cada mutación. Añade el trigger de sync **sin** romper offline-first: si no hay servicio, no hace nada. Usa un singleton perezoso para no acoplar el store al controller en tests.

Modifica el helper `persist` en `lib/store/vault-store.ts`:

```typescript
// lib/store/vault-store.ts — reemplazar la función persist por:
import { maybeSchedulePush } from '@/lib/sync/sync-trigger';

async function persist(get: () => VaultState) {
  const { key, data } = get();
  if (key && data) {
    await vaultService.persist(key, data);
    await repository.saveSyncState({ version: (await repository.getSyncState())?.version ?? 0, updatedAt: new Date().toISOString() });
    maybeSchedulePush();
  }
}
```

Añade el import de `repository` arriba en `vault-store.ts` si no está:

```typescript
import { repository } from '@/lib/db/repository';
```

- [ ] **Step 5: Crear el trigger desacoplado `sync-trigger.ts`**

Mantiene el `vault-store` libre de dependencias pesadas de sync y permite mocking trivial en los tests del store.

```typescript
// lib/sync/sync-trigger.ts
import { isSyncEnabled, createSyncService } from './sync-controller';
import type { SyncService } from './sync-service';

let servicePromise: Promise<SyncService | null> | null = null;

/** Singleton perezoso del SyncService (una sola instancia por sesión de app). */
export function getSyncService(): Promise<SyncService | null> {
  if (!isSyncEnabled()) return Promise.resolve(null);
  if (!servicePromise) servicePromise = createSyncService();
  return servicePromise;
}

/** Programa un push con debounce si el sync está activo; no-op en Phase 1. */
export function maybeSchedulePush(): void {
  if (!isSyncEnabled()) return;
  void getSyncService().then((svc) => svc?.schedulePush());
}

/** Pull inicial al unlock; no-op en Phase 1. */
export function maybeReconcileNow(): void {
  if (!isSyncEnabled()) return;
  void getSyncService().then((svc) => svc?.reconcileNow());
}

/** Resetea el singleton (sign-out / tests). */
export function resetSyncService(): void {
  servicePromise = null;
}
```

- [ ] **Step 6: Registrar triggers de pull (unlock, visibilitychange, online)**

En `lib/store/vault-store.ts`, dentro de `unlock()`, tras `set(...)` añade el pull inicial:

```typescript
  async unlock(password) {
    const { key, data } = await vaultService.unlock(password);
    set({ key, data, locked: false });
    maybeReconcileNow();
  },
```

Y actualiza el import del trigger en `vault-store.ts`:

```typescript
import { maybeSchedulePush, maybeReconcileNow } from '@/lib/sync/sync-trigger';
```

Crea un hook cliente que ata `visibilitychange`/`online` (se montará en el layout del grupo `(vault)`):

```typescript
// lib/sync/use-sync-lifecycle.ts
'use client';
import { useEffect } from 'react';
import { isSyncEnabled, } from './sync-controller';
import { getSyncService, maybeReconcileNow } from './sync-trigger';

/** Monta listeners de ciclo de vida para pull en foco/online y flush en pagehide. */
export function useSyncLifecycle(): void {
  useEffect(() => {
    if (!isSyncEnabled()) return;
    const onVisible = () => { if (document.visibilityState === 'visible') maybeReconcileNow(); };
    const onOnline = () => maybeReconcileNow();
    const onHide = () => { void getSyncService().then((svc) => svc?.flush()); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
}
```

Móntalo en el layout del grupo `(vault)` (un único punto, vale para todas las plataformas). Localiza `app/(vault)/layout.tsx` (o el componente cliente que envuelve el grupo) y llama `useSyncLifecycle()` dentro de un componente cliente. Si el layout es Server Component, crea un wrapper cliente mínimo:

```typescript
// components/sync/sync-lifecycle.tsx
'use client';
import { useSyncLifecycle } from '@/lib/sync/use-sync-lifecycle';
export function SyncLifecycle() { useSyncLifecycle(); return null; }
```

Y renderiza `<SyncLifecycle />` en `app/(vault)/layout.tsx`.

- [ ] **Step 7: Correr tests del controller y del store**

Run: `pnpm vitest run tests/sync/sync-controller.test.ts tests/store`
Expected: PASS. Si algún test del store falla por el import de `sync-trigger`, añade en `tests/setup.ts` (o el propio test) un mock: `vi.mock('@/lib/sync/sync-trigger', () => ({ maybeSchedulePush: () => {}, maybeReconcileNow: () => {} }))`. Documenta el mock en el commit.

- [ ] **Step 8: Typecheck completo**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/sync/sync-controller.ts lib/sync/sync-trigger.ts lib/sync/use-sync-lifecycle.ts components/sync/sync-lifecycle.tsx lib/store/vault-store.ts app/\(vault\)/layout.tsx tests/sync/sync-controller.test.ts
git commit -m "feat(sync): wire SyncService behind flag+session; debounced push + lifecycle pulls"
```

---

## Task 8: i18n — claves de sync (es/en)

**Files:**
- Modify: `lib/i18n/dict.ts`

- [ ] **Step 1: Añadir las claves al bloque `en`**

Inserta antes del cierre `} as const;` del objeto `en` (línea ~246):

```typescript
  // ── Sync / Conflict ─────────────────────────────────────────────────────────
  'sync.statusIdle':            'Synced',
  'sync.statusSyncing':         'Syncing…',
  'sync.statusError':           'Sync error — will retry',
  'sync.statusConflict':        'Sync conflict — action needed',
  'sync.lastSynced':            'Last synced {time}',
  'sync.never':                 'Not synced yet',
  'sync.conflictTitle':         'This vault changed on another device',
  'sync.conflictBody':          'Your vault was edited on more than one device. Choose which version to keep — the other will be replaced.',
  'sync.conflictThisDevice':    'This device',
  'sync.conflictOtherDevice':   'The other device',
  'sync.conflictEditedAt':      'Edited {time}',
  'sync.conflictKeepLocal':     'Keep this device',
  'sync.conflictUseRemote':     'Use the other device',
  'sync.conflictCancel':        'Decide later',
  'sync.conflictResolving':     'Resolving…',
```

- [ ] **Step 2: Añadir las mismas claves al bloque `es`**

Inserta antes del cierre `} as const;` del objeto `es` (línea ~485):

```typescript
  // ── Sync / Conflict ─────────────────────────────────────────────────────────
  'sync.statusIdle':            'Sincronizado',
  'sync.statusSyncing':         'Sincronizando…',
  'sync.statusError':           'Error de sincronización — se reintentará',
  'sync.statusConflict':        'Conflicto de sincronización — requiere acción',
  'sync.lastSynced':            'Última sincronización {time}',
  'sync.never':                 'Aún sin sincronizar',
  'sync.conflictTitle':         'Este vault cambió en otro dispositivo',
  'sync.conflictBody':          'Tu vault se editó en más de un dispositivo. Elige qué versión conservar — la otra será reemplazada.',
  'sync.conflictThisDevice':    'Este dispositivo',
  'sync.conflictOtherDevice':   'El otro dispositivo',
  'sync.conflictEditedAt':      'Editado {time}',
  'sync.conflictKeepLocal':     'Conservar este dispositivo',
  'sync.conflictUseRemote':     'Usar el otro dispositivo',
  'sync.conflictCancel':        'Decidir más tarde',
  'sync.conflictResolving':     'Resolviendo…',
```

- [ ] **Step 3: Typecheck (las claves nuevas deben existir en ambos locales)**

Run: `pnpm tsc --noEmit`
Expected: PASS (el tipo `DictKey` deriva de `en`; `DICT` exige que `es` cubra las mismas claves).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/dict.ts
git commit -m "feat(i18n): sync + conflict strings (es/en)"
```

---

## Task 9: Conflict UX — diálogo "este dispositivo / el otro dispositivo"

Prompt SOLO en conflicto real (decisión §3.1 del spec). El componente lee `syncStore.conflict`, muestra ambos timestamps y llama a `resolveConflictKeepLocal` / `resolveConflictUseRemote` del `SyncService`.

**Files:**
- Create: `components/sync/conflict-dialog.tsx`
- Create: `tests/sync/conflict-dialog.test.tsx`

- [ ] **Step 1: Escribir el test de componente PRIMERO**

```tsx
// tests/sync/conflict-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictDialog } from '@/components/sync/conflict-dialog';
import { syncStore } from '@/lib/store/sync-store';

const keepLocal = vi.fn().mockResolvedValue(undefined);
const useRemote = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/sync/sync-trigger', () => ({
  getSyncService: () => Promise.resolve({
    resolveConflictKeepLocal: keepLocal,
    resolveConflictUseRemote: useRemote,
  }),
}));

const conflict = {
  localUpdatedAt: '2026-06-06T10:07:00.000Z',
  remoteUpdatedAt: '2026-06-06T10:03:00.000Z',
  remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' },
};

describe('ConflictDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); syncStore.getState().reset(); });

  it('renders nothing when there is no conflict', () => {
    const { container } = render(<ConflictDialog />);
    expect(container.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });

  it('shows both device labels when a conflict is present', () => {
    syncStore.getState().setConflict(conflict);
    render(<ConflictDialog />);
    expect(screen.getByText(/this device|este dispositivo/i)).toBeTruthy();
    expect(screen.getByText(/the other device|el otro dispositivo/i)).toBeTruthy();
  });

  it('keep-local calls resolveConflictKeepLocal with the remote', async () => {
    syncStore.getState().setConflict(conflict);
    render(<ConflictDialog />);
    await userEvent.click(screen.getByRole('button', { name: /keep this device|conservar este dispositivo/i }));
    expect(keepLocal).toHaveBeenCalledWith(conflict.remote);
  });

  it('use-remote calls resolveConflictUseRemote with the remote', async () => {
    syncStore.getState().setConflict(conflict);
    render(<ConflictDialog />);
    await userEvent.click(screen.getByRole('button', { name: /use the other device|usar el otro dispositivo/i }));
    expect(useRemote).toHaveBeenCalledWith(conflict.remote);
  });
});
```

- [ ] **Step 2: Correr y ver FAIL esperado**

Run: `pnpm vitest run tests/sync/conflict-dialog.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/sync/conflict-dialog"`.

- [ ] **Step 3: Implementar `conflict-dialog.tsx`**

```tsx
// components/sync/conflict-dialog.tsx
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/use-t';
import { useSyncStore } from '@/lib/store/sync-store';
import { getSyncService } from '@/lib/sync/sync-trigger';
import type { RemoteVault } from '@/lib/sync/types';

function fmt(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ConflictDialog() {
  const t = useT();
  const conflict = useSyncStore((s) => s.conflict);
  const [resolving, setResolving] = useState(false);

  if (!conflict) return null;

  const resolve = async (which: 'local' | 'remote', remote: RemoteVault) => {
    setResolving(true);
    try {
      const svc = await getSyncService();
      if (!svc) return;
      if (which === 'local') await svc.resolveConflictKeepLocal(remote);
      else await svc.resolveConflictUseRemote(remote);
    } finally {
      setResolving(false);
    }
  };

  return (
    <Dialog open={!!conflict}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('sync.conflictTitle')}</DialogTitle>
          <DialogDescription>{t('sync.conflictBody')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg ring-1 ring-foreground/10 p-3">
            <p className="font-heading text-sm font-medium">{t('sync.conflictThisDevice')}</p>
            <p className="text-xs text-muted-foreground">{t('sync.conflictEditedAt', { time: fmt(conflict.localUpdatedAt, 'default') })}</p>
          </div>
          <div className="rounded-lg ring-1 ring-foreground/10 p-3">
            <p className="font-heading text-sm font-medium">{t('sync.conflictOtherDevice')}</p>
            <p className="text-xs text-muted-foreground">{t('sync.conflictEditedAt', { time: fmt(conflict.remoteUpdatedAt, 'default') })}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={resolving} onClick={() => void resolve('remote', conflict.remote)}>
            {resolving ? t('sync.conflictResolving') : t('sync.conflictUseRemote')}
          </Button>
          <Button disabled={resolving} onClick={() => void resolve('local', conflict.remote)}>
            {resolving ? t('sync.conflictResolving') : t('sync.conflictKeepLocal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Nota: `fmt(..., 'default')` usa el locale del runtime; si se quiere atar al locale del usuario, leer `useSettingsStore(s => s.settings.locale)` y pasarlo. Mantener simple aquí.

- [ ] **Step 4: Montar el diálogo globalmente**

Renderiza `<ConflictDialog />` junto a `<SyncLifecycle />` en `app/(vault)/layout.tsx` (un único punto, todas las plataformas).

- [ ] **Step 5: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/conflict-dialog.test.tsx`
Expected: PASS (4 tests verdes).

- [ ] **Step 6: Commit**

```bash
git add components/sync/conflict-dialog.tsx tests/sync/conflict-dialog.test.tsx app/\(vault\)/layout.tsx
git commit -m "feat(sync): conflict dialog (this device / other device) + global mount"
```

---

## Task 10: Estado de sync en Settings (Account)

Muestra el estado observable (`syncStore`) en la sección Account de Settings (creada en S4). Sin sesión o con flag off → no se renderiza.

**Files:**
- Create: `components/sync/sync-status.tsx`
- Modify: `app/(vault)/settings/page.tsx`

- [ ] **Step 1: Implementar `sync-status.tsx`**

```tsx
// components/sync/sync-status.tsx
'use client';

import { useT } from '@/lib/i18n/use-t';
import { useSyncStore } from '@/lib/store/sync-store';
import { isSyncEnabled } from '@/lib/sync/sync-controller';

export function SyncStatus() {
  const t = useT();
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  if (!isSyncEnabled()) return null;

  const label =
    status === 'syncing' ? t('sync.statusSyncing')
    : status === 'error' ? t('sync.statusError')
    : status === 'conflict' ? t('sync.statusConflict')
    : t('sync.statusIdle');

  const sub = lastSyncedAt
    ? t('sync.lastSynced', { time: new Date(lastSyncedAt).toLocaleString() })
    : t('sync.never');

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">{label}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}
```

- [ ] **Step 2: Insertar `<SyncStatus />` en la sección Account de Settings**

Localiza la sección Account en `app/(vault)/settings/page.tsx` (añadida en S4) y renderiza `<SyncStatus />` debajo del email/estado de cuenta. Si la sección Account aún no existe (S4 no completado), añade un bloque mínimo provisional condicionado a `isSyncEnabled()` que solo muestre `<SyncStatus />`, y deja un comentario `// TODO(S4): integrar con sección Account completa`.

- [ ] **Step 3: Typecheck + arranque dev para verificación visual rápida**

Run: `pnpm tsc --noEmit`
Expected: PASS. (La verificación visual de sync real se hace E2E en S8/S12; aquí basta con que compile y renderice sin sesión = nada.)

- [ ] **Step 4: Commit**

```bash
git add components/sync/sync-status.tsx app/\(vault\)/settings/page.tsx
git commit -m "feat(sync): show sync status in Settings Account section"
```

---

## Task 11: Test de integración — frontera zero-knowledge (sync nunca ve plaintext)

Prueba explícita de que el code path de push transporta SOLO ciphertext: dado un blob real cifrado, el `SyncRepository` recibe exactamente esa cadena opaca y la RPC no lleva ninguna estructura plaintext ni `CryptoKey`.

**Files:**
- Create: `tests/sync/zero-knowledge.test.ts`

- [ ] **Step 1: Escribir el test**

```typescript
// tests/sync/zero-knowledge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { deriveKey, encrypt, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import { SyncRepository } from '@/lib/sync/sync-repository';

describe('zero-knowledge sync boundary', () => {
  it('SyncRepository.pushVault transports only opaque ciphertext (no plaintext, no key)', async () => {
    // 1. Cifrar un VaultData real → ciphertext opaco.
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey('TestPassword1!', kdf);
    const plaintext = JSON.stringify({ subscriptions: [{ serviceName: 'Netflix', amount: 15.99 }], credentials: [{ password: 'SUPER_SECRET' }], paymentMethods: [] });
    const encryptedBlob = await encrypt(key, plaintext);
    const encryptedMeta = JSON.stringify({ schemaVersion: 1, kdf, verifier: await encrypt(key, 'v') });

    // 2. Capturar exactamente lo que se envía a Supabase.
    const rpc = vi.fn().mockResolvedValue({
      data: { encrypted_meta: encryptedMeta, encrypted_blob: encryptedBlob, version: 1, updated_at: '2026-06-06T10:00:00.000Z' },
      error: null,
    });
    const client = { rpc, from: vi.fn() } as any;
    const repo = new SyncRepository(client, 'user-1');

    await repo.pushVault(encryptedMeta, encryptedBlob, 0);

    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('upsert_vault');

    // 3. Aserciones ZK: el blob enviado NO contiene plaintext sensible ni la clave.
    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain('SUPER_SECRET');
    expect(serialized).not.toContain('Netflix');
    expect(args.p_blob).toBe(encryptedBlob);              // es la MISMA cadena cifrada
    expect(args.p_blob).not.toContain('subscriptions');   // no es JSON plaintext
    expect(Object.values(args).every((v) => typeof v === 'string' || typeof v === 'number')).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y ver PASS**

Run: `pnpm vitest run tests/sync/zero-knowledge.test.ts`
Expected: PASS (1 test verde). Si el entorno no expone WebCrypto/argon2 en Node, asegúrate de que `tests/setup.ts` ya configura `crypto` (lo usan los tests de Phase 1 en `tests/crypto`).

- [ ] **Step 3: Commit**

```bash
git add tests/sync/zero-knowledge.test.ts
git commit -m "test(sync): assert push path carries only opaque ciphertext (ZK boundary)"
```

---

## Task 12: Gates y cierre

**Files:** (sin nuevos archivos de producto)

- [ ] **Step 1: Suite completa verde**

Run: `pnpm vitest run`
Expected: PASS — todas las suites (Phase 1 + nuevas de sync) verdes.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm build`
Expected: PASS. El build con `NEXT_PUBLIC_SYNC_ENABLED` ausente NO debe romper (sync deshabilitado por defecto).

- [ ] **Step 3: `/code-review`**

Ejecuta `/code-review` sobre el diff de S6. Atiende hallazgos de correctness/reuse. Re-corre tests tras cualquier cambio.

- [ ] **Step 4: `typescript-reviewer`**

Dispara el subagente `typescript-reviewer` sobre los `.ts/.tsx` nuevos/modificados (diff sustancial). Aplica feedback verificado (skill receiving-code-review).

- [ ] **Step 5: `/security-review`**

Ejecuta `/security-review` — esta sesión toca el límite auth + crypto. Verifica explícitamente: (a) `SyncRepository` solo transporta ciphertext; (b) el descifrado vive solo en `sync-controller.applyRemote` (cliente, con clave en memoria); (c) sin sesión / sin flag no se instancia nada; (d) ningún secreto en bundle.

- [ ] **Step 6: Verificación (verification-before-completion)**

Confirma con evidencia: salida de `pnpm vitest run` (conteo de tests), `pnpm build` OK, y enumera los archivos creados/modificados. No declares completo sin esta evidencia.

- [ ] **Step 7: Commit final + `/compact`**

```bash
git add -A
git commit -m "chore(s6): review gates green — encrypted sync engine (CP3) complete"
```

Output: `✅ CP3: zero-knowledge sync with version-based conflict handling`. Luego `/compact`.

---

## Self-review (cubierto)

- **Reconcile exhaustivo (CP3 Task 3.1):** Task 2 cubre local-ahead, remote-ahead, equal, both-changed=conflict, sin remoto, sin local, defensivo. ✓
- **sync-repository + mapping 40001 (CP3 Task 3.2):** Task 4, `ConflictError` tipado, assert solo-ciphertext. ✓
- **sync-service + store + debounce (CP3 Task 3.3):** Tasks 5–7; debounce 4000 ms justificado por cuotas. ✓
- **Conflict UX, prompt solo en conflicto real (CP3 Task 3.4, spec §3.1):** Task 9; nunca silencioso, sin pérdida de datos. ✓
- **Flag + sesión + offline-first (spec §5.3):** Task 7 gating; Phase 1 intacto sin flag/sesión/red. ✓
- **ZK boundary cubierto por test:** Task 11. ✓
- **Multi-device single code path:** Goal/Architecture + montaje único en `(vault)/layout.tsx`. ✓
- **i18n es/en:** Task 8 (mismas claves en ambos). ✓
