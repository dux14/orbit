# WebAuthn PRF Biometric Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desbloqueo biométrico (Face ID / huella) en Orbit vía WebAuthn PRF, manteniendo zero-knowledge, offline-first y la contraseña maestra como fallback siempre disponible. Pre-requisito: migrar el cifrado actual a *envelope encryption* sin perder compatibilidad con bóvedas existentes.

**Architecture:** Hoy `KEK = Argon2id(password)` cifra el blob directamente (`vault-service.create/unlock/persist`). Se migra a:
- **`VaultKey`** — clave AES-256-GCM aleatoria, no extraíble en uso, que cifra/descifra el blob (`blob` table). Es la única clave que ve `vaultService.persist`.
- **`KEK_master`** = `Argon2id(password)` → **envuelve** `VaultKey` con **AES-KW** (`wrapKey`/`unwrapKey`, RFC 3394). El wrap se guarda en `meta.wrappedKeys.master` (base64).
- **`KEK_bio`** (opcional) = `HKDF-SHA256(PRF_output)` → envuelve una **segunda copia** de la misma `VaultKey` con AES-KW. El wrap + `credentialId` + `prfSalt` viven en una tabla IndexedDB nueva (`bio`), nunca en `meta` (la bóveda exportada no debe arrastrar credenciales ligadas a un dispositivo).
- **Verifier:** se conserva el esquema actual (`verifier` = AES-GCM de una constante) pero ahora se cifra con `VaultKey`, no con `KEK_master`. Tras desenvolver `VaultKey` (por cualquier ruta) se valida contra el verifier. Esto detecta password incorrecto (el `unwrapKey` AES-KW falla → no hay `VaultKey`) y corrupción.

**Decisión AES-KW vs AES-GCM-wrap:** se usa **AES-KW** (`{ name: 'AES-KW' }` con `wrapKey`/`unwrapKey`). Razones: (1) está diseñado exactamente para envolver material de clave, sin IV ni nonce que gestionar/almacenar; (2) un fallo de integridad (password/PRF incorrecto) hace que `unwrapKey` rechace — no hace falta un MAC separado; (3) Node y todos los navegadores objetivo lo soportan (verificado en este entorno). AES-GCM-wrap exigiría almacenar+rotar un IV por cada wrap y derivar un `CryptoKey` con `wrapKey`/`unwrapKey` desde Argon2id; AES-KW es más simple y menos propenso a reutilizar IV.

**Decisión formato de meta versionado:** `VaultMeta.envelopeVersion?: number` (ausente/`undefined` = formato legado v0; `1` = envelope). Se mantiene `schemaVersion` para la forma de `VaultData` (sin tocar). En el primer `unlock` de una bóveda v0 se migra de forma transparente: derivar `KEK_master`, descifrar el blob con el esquema viejo, generar `VaultKey`, re-cifrar blob+verifier con `VaultKey`, envolver `VaultKey` con `KEK_master`, escribir `envelopeVersion: 1` + `wrappedKeys.master`. La migración corre dentro de una transacción Dexie.

**Tech Stack:** Next.js 16.2.7 (App Router, PWA Serwist), React 19, TypeScript, Zustand (vanilla store), Dexie/IndexedDB, hash-wasm (Argon2id), WebCrypto (AES-GCM + AES-KW + HKDF), WebAuthn (`navigator.credentials` + extensión `prf`), Vitest (jsdom + fake-indexeddb), Playwright (Chrome, virtual authenticator vía CDP). **SIEMPRE `pnpm`.**

**Punto de corte de contexto:** Tasks 1–6 = **S9a** (envelope encryption + migración). Tasks 7–14 = **S9b** (WebAuthn PRF). Si el contexto se agota, cerrar S9a con sus gates y commit propio; retomar S9b en sesión nueva leyendo este plan. El verifier sigue siendo `VaultKey`-based tras S9a, así que S9b no toca el path de password.

---

## S9a — Envelope encryption

### Task 1: Tipos de meta versionados + helpers base64 reutilizados

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/types.ts`

- [ ] En `lib/types.ts`, extender `VaultMeta` con los campos de envelope (sin romper v0: todos opcionales). Reemplazar la interfaz actual por:
  ```ts
  export interface WrappedKeys {
    /** VaultKey envuelta con KEK_master (Argon2id(password)) vía AES-KW, base64. */
    master: string;
  }

  export interface VaultMeta {
    schemaVersion: number;          // forma de VaultData (sin cambios)
    kdf: KdfParams;
    verifier: string;               // base64 AES-GCM(VERIFIER_CONSTANT) bajo VaultKey (v1) o KEK_master (v0)
    /** undefined => formato legado v0 (KDF cifra el blob directo). 1 => envelope. */
    envelopeVersion?: number;
    /** Presente solo cuando envelopeVersion >= 1. */
    wrappedKeys?: WrappedKeys;
  }
  ```
- [ ] Añadir el tipo de la fila de biometría que vivirá en IndexedDB (lo consumirá S9b, pero se declara aquí para no re-tocar el archivo):
  ```ts
  export interface BioCredential {
    credentialId: string;           // base64url del rawId del passkey
    prfSalt: string;                // base64 del salt PRF fijo de la app
    wrappedVaultKey: string;        // base64 AES-KW(VaultKey) bajo KEK_bio
    createdAt: string;              // ISO 8601
  }
  ```
- [ ] Verificar que `BackupFile.meta` es `VaultMeta` (ya lo es) — un backup v1 arrastra `envelopeVersion` y `wrappedKeys.master`, lo cual es correcto y portable (no incluye `BioCredential`, que es por-dispositivo).
- [ ] Ejecutar `pnpm exec tsc --noEmit` y confirmar 0 errores de tipos nuevos. Commit: `feat(crypto): versioned VaultMeta + BioCredential types for envelope encryption`.

### Task 2: Primitivas de envelope (TDD) — generar VaultKey, wrap/unwrap AES-KW

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/crypto/envelope.test.ts` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/crypto/envelope.ts` (nuevo)

- [ ] Escribir el test completo `tests/crypto/envelope.test.ts` ANTES de implementar:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { deriveKey, defaultKdf, generateSalt, encrypt, decrypt } from '@/lib/crypto/vault';
  import {
    generateVaultKey,
    deriveKekFromPassword,
    wrapVaultKey,
    unwrapVaultKey,
    exportVaultKeyRaw,
    importVaultKeyRaw,
  } from '@/lib/crypto/envelope';

  const kdf = () => ({ ...defaultKdf(), salt: generateSalt() });

  describe('envelope primitives', () => {
    it('generates a usable 256-bit AES-GCM VaultKey', async () => {
      const vk = await generateVaultKey();
      const ct = await encrypt(vk, 'payload');
      expect(await decrypt(vk, ct)).toBe('payload');
    });

    it('wraps and unwraps VaultKey with KEK_master (round-trip)', async () => {
      const params = kdf();
      const kek = await deriveKekFromPassword('master-pw', params);
      const vk = await generateVaultKey();
      const wrapped = await wrapVaultKey(vk, kek);
      expect(typeof wrapped).toBe('string');
      const vk2 = await unwrapVaultKey(wrapped, kek);
      // Same key material => can decrypt what the original encrypted
      const ct = await encrypt(vk, 'secret');
      expect(await decrypt(vk2, ct)).toBe('secret');
    });

    it('unwrap with the wrong KEK rejects (AES-KW integrity)', async () => {
      const params = kdf();
      const vk = await generateVaultKey();
      const wrapped = await wrapVaultKey(vk, await deriveKekFromPassword('right', params));
      await expect(
        unwrapVaultKey(wrapped, await deriveKekFromPassword('wrong', params)),
      ).rejects.toThrow();
    });

    it('exports and re-imports raw VaultKey material', async () => {
      const vk = await generateVaultKey();
      const raw = await exportVaultKeyRaw(vk);
      expect(raw.byteLength).toBe(32);
      const vk2 = await importVaultKeyRaw(raw);
      const ct = await encrypt(vk, 'x');
      expect(await decrypt(vk2, ct)).toBe('x');
    });
  });
  ```
- [ ] Ejecutar `pnpm test tests/crypto/envelope.test.ts` → confirmar FAIL por módulo inexistente.
- [ ] Implementar `lib/crypto/envelope.ts` con WebCrypto real:
  ```ts
  import { argon2id } from 'hash-wasm';
  import { fromBase64, toBase64 } from './vault';
  import type { KdfParams } from '@/lib/types';

  /** Random non-extractable-in-use AES-256-GCM key (extractable=true so it can be wrapped/exported). */
  export async function generateVaultKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  /** KEK from password via Argon2id, imported as an AES-KW key for wrap/unwrap only. */
  export async function deriveKekFromPassword(password: string, kdf: KdfParams): Promise<CryptoKey> {
    const rawResult = await argon2id({
      password,
      salt: fromBase64(kdf.salt),
      parallelism: kdf.parallelism,
      iterations: kdf.iterations,
      memorySize: kdf.memorySize,
      hashLength: kdf.hashLength,
      outputType: 'binary',
    });
    const raw = new Uint8Array(rawResult as Uint8Array);
    return crypto.subtle.importKey('raw', raw, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey']);
  }

  /** Wrap VaultKey with a KEK using AES-KW. Returns base64. */
  export async function wrapVaultKey(vaultKey: CryptoKey, kek: CryptoKey): Promise<string> {
    const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, kek, { name: 'AES-KW' });
    return toBase64(new Uint8Array(wrapped));
  }

  /** Unwrap a base64 AES-KW blob back into a usable AES-GCM VaultKey. Throws on bad KEK. */
  export async function unwrapVaultKey(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
    return crypto.subtle.unwrapKey(
      'raw',
      fromBase64(wrapped),
      kek,
      { name: 'AES-KW' },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  export async function exportVaultKeyRaw(vaultKey: CryptoKey): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey));
  }

  export async function importVaultKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  ```
- [ ] Ejecutar `pnpm test tests/crypto/envelope.test.ts` → confirmar PASS (4 tests).
- [ ] Commit: `feat(crypto): envelope primitives (VaultKey gen + AES-KW wrap/unwrap)`.

### Task 3: Repository — tabla `bio` (Dexie v2) y accesores

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/db/database.ts`
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/db/repository.ts`
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/db/repository.test.ts` (extender o crear)

- [ ] En `lib/db/database.ts`: añadir la tabla `bio` y bump a `version(2)`. Mantener la migración Dexie aditiva (no se borran datos v1):
  ```ts
  import Dexie, { type Table } from 'dexie';
  import type { VaultMeta, Settings, FxRatesCache, BioCredential } from '@/lib/types';

  interface KeyedRow<T> { key: string; value: T; }

  export class OrbitDB extends Dexie {
    meta!: Table<KeyedRow<VaultMeta>, string>;
    blob!: Table<KeyedRow<string>, string>;
    settings!: Table<KeyedRow<Settings>, string>;
    fx!: Table<KeyedRow<FxRatesCache>, string>;
    bio!: Table<KeyedRow<BioCredential>, string>;

    constructor() {
      super('orbit');
      this.version(1).stores({ meta: 'key', blob: 'key', settings: 'key', fx: 'key' });
      this.version(2).stores({ meta: 'key', blob: 'key', settings: 'key', fx: 'key', bio: 'key' });
    }
  }

  export const db = new OrbitDB();
  ```
- [ ] En `lib/db/repository.ts`: añadir `BIO_KEY`, accesores y limpiar `bio` en `wipeVault`:
  ```ts
  const BIO_KEY = 'bio';
  // ... dentro de repository:
  async getMeta(): ... // sin cambios
  async saveMeta(meta: VaultMeta): Promise<void> {
    await db.meta.put({ key: META_KEY, value: meta });
  },
  async getBio(): Promise<BioCredential | undefined> {
    return (await db.bio.get(BIO_KEY))?.value;
  },
  async saveBio(bio: BioCredential): Promise<void> {
    await db.bio.put({ key: BIO_KEY, value: bio });
  },
  async deleteBio(): Promise<void> {
    await db.bio.delete(BIO_KEY);
  },
  ```
  Importar `BioCredential` en el `import type`. Añadir `db.bio` a la transacción y al `Promise.all` de `wipeVault`.
- [ ] Escribir/extender `tests/db/repository.test.ts` con un caso bio:
  ```ts
  it('stores, reads and deletes a bio credential; wipe clears it', async () => {
    const bio = { credentialId: 'abc', prfSalt: 'c2FsdA==', wrappedVaultKey: 'd3JhcA==', createdAt: '2026-06-06T00:00:00Z' };
    await repository.saveBio(bio);
    expect(await repository.getBio()).toEqual(bio);
    await repository.deleteBio();
    expect(await repository.getBio()).toBeUndefined();
    await repository.saveBio(bio);
    await repository.wipeVault();
    expect(await repository.getBio()).toBeUndefined();
  });
  ```
  (Si el archivo no existe, crearlo con `import { db } from '@/lib/db/database'; import { repository } from '@/lib/db/repository';` y `beforeEach(async () => { await db.delete(); await db.open(); });`.)
- [ ] Ejecutar `pnpm test tests/db/repository.test.ts` → PASS.
- [ ] Commit: `feat(db): bio table (Dexie v2) + saveMeta/getBio/saveBio/deleteBio accessors`.

### Task 4: vault-service — create/unlock/persist en formato envelope v1 (TDD)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/services/vault-service.test.ts` (extender)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/services/vault-service.ts`

- [ ] Añadir tests al final de `tests/services/vault-service.test.ts` (los existentes deben seguir verdes — la API pública `create/unlock/persist` no cambia de firma):
  ```ts
  import { repository } from '@/lib/db/repository';

  it('create writes envelope v1 meta (envelopeVersion + wrappedKeys.master)', async () => {
    await vaultService.create('master-pw');
    const meta = await repository.getMeta();
    expect(meta?.envelopeVersion).toBe(1);
    expect(typeof meta?.wrappedKeys?.master).toBe('string');
    expect(meta?.wrappedKeys?.master.length).toBeGreaterThan(0);
  });

  it('unlock returns a VaultKey that decrypts the blob, not the KEK', async () => {
    const created = await vaultService.create('pw');
    const data = { ...empty(), paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] };
    await vaultService.persist(created.key, data);
    const next = await vaultService.unlock('pw');
    expect(next.data.paymentMethods).toHaveLength(1);
    // The returned key is the VaultKey: it must be the SAME material across unlocks
    // (re-deriving KEK each time, but unwrapping the same stored VaultKey).
    const again = await vaultService.unlock('pw');
    const ct = await (await import('@/lib/crypto/vault')).encrypt(next.key, 'probe');
    expect(await (await import('@/lib/crypto/vault')).decrypt(again.key, ct)).toBe('probe');
  });
  ```
- [ ] Ejecutar `pnpm test tests/services/vault-service.test.ts` → confirmar FAIL en los nuevos (envelopeVersion undefined).
- [ ] Reescribir `lib/services/vault-service.ts`. `create` genera VaultKey, la envuelve con KEK_master, cifra blob+verifier con VaultKey. `unlock` deriva KEK_master, **desenvuelve** VaultKey (rechazo de AES-KW = password incorrecto), valida verifier, descifra blob. `persist` cifra con la VaultKey (que es `session.key`):
  ```ts
  import { repository } from '@/lib/db/repository';
  import { encrypt, decrypt, createVerifier, checkVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
  import { generateVaultKey, deriveKekFromPassword, wrapVaultKey, unwrapVaultKey } from '@/lib/crypto/envelope';
  import { migrateLegacyVault } from './vault-migration';
  import type { VaultData, VaultMeta } from '@/lib/types';

  const SCHEMA_VERSION = 1;
  const ENVELOPE_VERSION = 1;
  const emptyData = (): VaultData => ({ subscriptions: [], credentials: [], paymentMethods: [] });

  export interface VaultSession { key: CryptoKey; data: VaultData; }

  export const vaultService = {
    exists: () => repository.vaultExists(),

    async create(password: string): Promise<VaultSession> {
      const kdf = { ...defaultKdf(), salt: generateSalt() };
      const kek = await deriveKekFromPassword(password, kdf);
      const vaultKey = await generateVaultKey();
      const wrappedMaster = await wrapVaultKey(vaultKey, kek);
      const verifier = await createVerifier(vaultKey);
      const meta: VaultMeta = {
        schemaVersion: SCHEMA_VERSION,
        kdf,
        verifier,
        envelopeVersion: ENVELOPE_VERSION,
        wrappedKeys: { master: wrappedMaster },
      };
      const data = emptyData();
      const blob = await encrypt(vaultKey, JSON.stringify(data));
      await repository.createVault(meta, blob);
      return { key: vaultKey, data };
    },

    async unlock(password: string): Promise<VaultSession> {
      let meta = await repository.getMeta();
      if (!meta) throw new Error('No vault exists');

      // Transparent backward-compatible migration of v0 vaults on first unlock.
      if (meta.envelopeVersion === undefined || meta.wrappedKeys === undefined) {
        meta = await migrateLegacyVault(password, meta);
      }

      const kek = await deriveKekFromPassword(password, meta.kdf);
      let vaultKey: CryptoKey;
      try {
        vaultKey = await unwrapVaultKey(meta.wrappedKeys!.master, kek);
      } catch {
        throw new Error('Incorrect master password');
      }
      if (!(await checkVerifier(vaultKey, meta.verifier))) throw new Error('Incorrect master password');
      const blob = await repository.getEncryptedData();
      const data: VaultData = blob ? JSON.parse(await decrypt(vaultKey, blob)) : emptyData();
      return { key: vaultKey, data };
    },

    async persist(key: CryptoKey, data: VaultData): Promise<void> {
      await repository.saveEncryptedData(await encrypt(key, JSON.stringify(data)));
    },
  };
  ```
  Nota: `session.key` ahora es la `VaultKey` (no la KEK). `vaultStore` lo usa en `persist` — sigue funcionando porque `persist` cifra con esa clave. No cambia la firma del store.
- [ ] Ejecutar `pnpm test tests/services/vault-service.test.ts` → todos PASS (incluidos los previos).
- [ ] Commit: `feat(vault): envelope encryption — create/unlock/persist via wrapped VaultKey`.

### Task 5: Migración transparente v0→v1 (TDD)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/services/vault-migration.test.ts` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/services/vault-migration.ts` (nuevo)

- [ ] Escribir `tests/services/vault-migration.test.ts` que primero **construye una bóveda v0** con el esquema legado (KDF cifra el blob directo, verifier bajo KDF) y luego verifica que `unlock` la migra y la deja desbloqueable:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { db } from '@/lib/db/database';
  import { repository } from '@/lib/db/repository';
  import { vaultService } from '@/lib/services/vault-service';
  import { deriveKey, encrypt, createVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
  import type { VaultMeta, VaultData } from '@/lib/types';

  beforeEach(async () => { await db.delete(); await db.open(); });

  /** Recreate a pre-envelope (v0) vault exactly as the old vault-service did. */
  async function seedLegacyVault(password: string, data: VaultData) {
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey(password, kdf);          // KDF key encrypts the blob directly
    const verifier = await createVerifier(key);
    const meta: VaultMeta = { schemaVersion: 1, kdf, verifier }; // NO envelopeVersion, NO wrappedKeys
    const blob = await encrypt(key, JSON.stringify(data));
    await repository.createVault(meta, blob);
  }

  describe('legacy v0 -> v1 migration', () => {
    it('migrates on first unlock and decrypts existing data', async () => {
      const data = { subscriptions: [], credentials: [], paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] };
      await seedLegacyVault('master-pw', data);

      const meta0 = await repository.getMeta();
      expect(meta0?.envelopeVersion).toBeUndefined();

      const session = await vaultService.unlock('master-pw');
      expect(session.data.paymentMethods).toHaveLength(1);

      const meta1 = await repository.getMeta();
      expect(meta1?.envelopeVersion).toBe(1);
      expect(typeof meta1?.wrappedKeys?.master).toBe('string');
      // kdf salt is preserved (same password still works)
      expect(meta1?.kdf.salt).toBe(meta0?.kdf.salt);
    });

    it('migrated vault unlocks normally on subsequent unlocks (no re-migration)', async () => {
      await seedLegacyVault('pw', { subscriptions: [], credentials: [], paymentMethods: [] });
      await vaultService.unlock('pw');                 // migrates
      const again = await vaultService.unlock('pw');   // pure envelope path
      expect(again.data).toEqual({ subscriptions: [], credentials: [], paymentMethods: [] });
    });

    it('rejects wrong password on a legacy vault without migrating', async () => {
      await seedLegacyVault('right', { subscriptions: [], credentials: [], paymentMethods: [] });
      await expect(vaultService.unlock('wrong')).rejects.toThrow(/master password/i);
      const meta = await repository.getMeta();
      expect(meta?.envelopeVersion).toBeUndefined(); // unchanged
    });
  });
  ```
- [ ] Ejecutar `pnpm test tests/services/vault-migration.test.ts` → FAIL (módulo inexistente).
- [ ] Implementar `lib/services/vault-migration.ts`. Debe: validar el password contra el verifier v0 (con la KDF-key directa) ANTES de migrar; si falla, lanzar sin tocar nada. Si pasa, descifrar blob v0, generar VaultKey, re-cifrar blob + verifier con VaultKey, envolver VaultKey con KEK_master, persistir meta v1 + blob nuevo en una transacción:
  ```ts
  import { db } from '@/lib/db/database';
  import { repository } from '@/lib/db/repository';
  import { deriveKey, decrypt, encrypt, createVerifier, checkVerifier } from '@/lib/crypto/vault';
  import { generateVaultKey, deriveKekFromPassword, wrapVaultKey } from '@/lib/crypto/envelope';
  import type { VaultMeta } from '@/lib/types';

  const ENVELOPE_VERSION = 1;

  /**
   * Migrate a legacy v0 vault (KDF key encrypts the blob directly) to envelope v1.
   * Validates the password against the v0 verifier first; throws on mismatch
   * WITHOUT mutating storage. On success, re-encrypts under a fresh VaultKey and
   * persists the new meta + blob atomically. Returns the new meta.
   */
  export async function migrateLegacyVault(password: string, meta: VaultMeta): Promise<VaultMeta> {
    // 1. v0 key derives directly from password and both verifies + decrypts the blob.
    const legacyKey = await deriveKey(password, meta.kdf);
    if (!(await checkVerifier(legacyKey, meta.verifier))) {
      throw new Error('Incorrect master password');
    }
    const blob = await repository.getEncryptedData();
    const plaintext = blob ? await decrypt(legacyKey, blob) : JSON.stringify({ subscriptions: [], credentials: [], paymentMethods: [] });

    // 2. New envelope material.
    const vaultKey = await generateVaultKey();
    const kek = await deriveKekFromPassword(password, meta.kdf); // reuse same salt/kdf params
    const wrappedMaster = await wrapVaultKey(vaultKey, kek);
    const newVerifier = await createVerifier(vaultKey);
    const newBlob = await encrypt(vaultKey, plaintext);

    const newMeta: VaultMeta = {
      ...meta,
      verifier: newVerifier,
      envelopeVersion: ENVELOPE_VERSION,
      wrappedKeys: { master: wrappedMaster },
    };

    // 3. Atomic write.
    await db.transaction('rw', db.meta, db.blob, async () => {
      await repository.saveMeta(newMeta);
      await repository.saveEncryptedData(newBlob);
    });

    return newMeta;
  }
  ```
- [ ] Ejecutar `pnpm test tests/services/vault-migration.test.ts` → PASS (3 tests).
- [ ] Commit: `feat(vault): transparent v0->v1 envelope migration on first unlock`.

### Task 6: backup/import compatibles con envelope (TDD)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/services/backup.test.ts` (extender o crear)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/services/backup.ts`

- [ ] Verificar comportamiento actual: `importBackup` deriva `deriveKey(password)` y descifra `file.data` directamente — eso es el path v0 y **se rompe** con un backup v1 (donde `file.data` está cifrado con VaultKey, no con KDF). Escribir test que exporte una bóveda v1 y la reimporte:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { db } from '@/lib/db/database';
  import { vaultService } from '@/lib/services/vault-service';
  import { exportBackup, importBackup } from '@/lib/services/backup';

  beforeEach(async () => { await db.delete(); await db.open(); });

  describe('backup with envelope encryption', () => {
    it('exports a v1 vault and re-imports it (round-trip)', async () => {
      const created = await vaultService.create('master-pw');
      await vaultService.persist(created.key, { subscriptions: [], credentials: [], paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] });

      const file = await exportBackup();
      expect(file.meta.envelopeVersion).toBe(1);

      await db.delete(); await db.open();
      const session = await importBackup(file, 'master-pw');
      expect(session.data.paymentMethods).toHaveLength(1);

      const next = await vaultService.unlock('master-pw');
      expect(next.data.paymentMethods).toHaveLength(1);
    });

    it('rejects a v1 backup with the wrong password', async () => {
      await vaultService.create('right-pw');
      const file = await exportBackup();
      await db.delete(); await db.open();
      await expect(importBackup(file, 'wrong-pw')).rejects.toThrow(/master password/i);
    });
  });
  ```
- [ ] Ejecutar `pnpm test tests/services/backup.test.ts` → FAIL (import descifra con KDF-key).
- [ ] Reescribir `importBackup` en `lib/services/backup.ts` para soportar ambos formatos. v1: desenvolver VaultKey con KEK_master y validar verifier con VaultKey. v0: comportamiento legado (no migrar aquí — al escribir el blob v0 + meta v0, el siguiente `unlock` lo migrará). El export no cambia (copia `meta` + blob tal cual):
  ```ts
  import { repository } from '@/lib/db/repository';
  import { deriveKey, checkVerifier, decrypt } from '@/lib/crypto/vault';
  import { deriveKekFromPassword, unwrapVaultKey } from '@/lib/crypto/envelope';
  import type { BackupFile, VaultData } from '@/lib/types';
  import type { VaultSession } from '@/lib/services/vault-service';

  const SCHEMA_VERSION = 1;

  export async function exportBackup(): Promise<BackupFile> {
    const meta = await repository.getMeta();
    const data = await repository.getEncryptedData();
    if (!meta || data === undefined) throw new Error('No vault to export');
    return { format: 'orbit-backup', schemaVersion: SCHEMA_VERSION, meta, data };
  }

  export async function importBackup(file: BackupFile, password: string): Promise<VaultSession> {
    if (file.format !== 'orbit-backup') throw new Error('Invalid backup file');

    let key: CryptoKey;
    if (file.meta.envelopeVersion && file.meta.wrappedKeys) {
      // v1 envelope: unwrap VaultKey, then verify with it.
      const kek = await deriveKekFromPassword(password, file.meta.kdf);
      try {
        key = await unwrapVaultKey(file.meta.wrappedKeys.master, kek);
      } catch {
        throw new Error('Incorrect master password');
      }
      if (!(await checkVerifier(key, file.meta.verifier))) throw new Error('Incorrect master password');
    } else {
      // v0 legacy: KDF key both verifies and decrypts the blob.
      key = await deriveKey(password, file.meta.kdf);
      if (!(await checkVerifier(key, file.meta.verifier))) throw new Error('Incorrect master password');
    }

    const data: VaultData = JSON.parse(await decrypt(key, file.data));
    await repository.createVault(file.meta, file.data); // restore meta+blob verbatim (v1 stays v1, v0 migrates on next unlock)
    return { key, data };
  }
  // downloadBackup / readBackupFile unchanged
  ```
  Mantener `downloadBackup` y `readBackupFile` sin cambios.
- [ ] Ejecutar `pnpm test tests/services/backup.test.ts` → PASS.
- [ ] **Gate S9a:** `pnpm test` (suite completa) → todo verde. `pnpm exec tsc --noEmit` → 0 errores. `pnpm lint` → limpio. Commit: `feat(backup): import/export compatible with envelope v1 (legacy v0 fallback)`.

> **PUNTO DE CORTE S9a / S9b.** Si el contexto va sobre ~70%, cerrar aquí: correr los gates de cierre parciales (`/security-review` sobre `lib/crypto/envelope.ts` + `lib/services/vault-migration.ts`, `/code-review`, `typescript-reviewer`), commit, y `/compact`. Retomar S9b en sesión nueva.

---

## S9b — WebAuthn PRF biometric unlock

### Task 7: Detección de soporte WebAuthn PRF + salt de la app

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/webauthn/support.ts` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/webauthn/support.test.ts` (nuevo)

- [ ] Escribir `tests/webauthn/support.test.ts`:
  ```ts
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { isPlatformAuthenticatorMaybeAvailable, APP_PRF_SALT_B64 } from '@/lib/webauthn/support';

  afterEach(() => { vi.unstubAllGlobals(); });

  describe('webauthn support detection', () => {
    it('returns false when PublicKeyCredential is undefined', async () => {
      vi.stubGlobal('PublicKeyCredential', undefined);
      expect(await isPlatformAuthenticatorMaybeAvailable()).toBe(false);
    });

    it('returns true when platform authenticator is available', async () => {
      vi.stubGlobal('PublicKeyCredential', {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
      });
      expect(await isPlatformAuthenticatorMaybeAvailable()).toBe(true);
    });

    it('exposes a fixed 32-byte app PRF salt', () => {
      // base64 of 32 bytes => 44 chars (with padding)
      expect(APP_PRF_SALT_B64.length).toBe(44);
    });
  });
  ```
- [ ] Ejecutar `pnpm test tests/webauthn/support.test.ts` → FAIL.
- [ ] Implementar `lib/webauthn/support.ts`. El salt PRF es **fijo y constante de la app** (no secreto: PRF lo combina con la clave del authenticator; el secreto vive en el hardware). Se persiste también en `BioCredential.prfSalt` por si en el futuro se rota:
  ```ts
  /**
   * Fixed application-wide PRF salt. PRF mixes this with the authenticator's
   * internal per-credential secret; the salt is NOT a secret itself. Stored per
   * credential (BioCredential.prfSalt) so a future rotation stays decryptable.
   * 32 bytes, base64. Generated once for Orbit and hardcoded intentionally.
   */
  export const APP_PRF_SALT_B64 = 'b3JiaXQtcHJmLXNhbHQtdjEtZG8tbm90LWNoYW5nZSEh'; // 32 bytes

  /** Cheap, synchronous-ish capability gate for showing the enroll UI. */
  export async function isPlatformAuthenticatorMaybeAvailable(): Promise<boolean> {
    if (typeof PublicKeyCredential === 'undefined') return false;
    const fn = (PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== 'function') return false;
    try {
      return await fn.call(PublicKeyCredential);
    } catch {
      return false;
    }
  }
  ```
  Nota: la disponibilidad real de la extensión PRF solo se conoce tras `create()` — por eso Task 9 trata el caso "create() no devolvió PRF" como no-enrolamiento (spec §3.6: sin PRF → no hay biometría).
- [ ] **Generar el salt real:** el valor de `APP_PRF_SALT_B64` arriba es ilustrativo. En la implementación, generar 32 bytes aleatorios una vez con `node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"` y pegar el resultado (debe medir 44 chars con padding). Ajustar el test si se prefiere validar `atob(APP_PRF_SALT_B64).length === 32` en lugar de la longitud base64.
- [ ] Ejecutar `pnpm test tests/webauthn/support.test.ts` → PASS.
- [ ] Commit: `feat(webauthn): platform authenticator detection + fixed app PRF salt`.

### Task 8: Derivación KEK_bio desde PRF (HKDF-SHA256) (TDD)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/tests/webauthn/kek-bio.test.ts` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/webauthn/kek-bio.ts` (nuevo)

- [ ] Escribir `tests/webauthn/kek-bio.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { deriveKekFromPrf } from '@/lib/webauthn/kek-bio';
  import { generateVaultKey, wrapVaultKey, unwrapVaultKey } from '@/lib/crypto/envelope';
  import { encrypt, decrypt } from '@/lib/crypto/vault';

  describe('KEK_bio from PRF output', () => {
    it('derives a stable AES-KW key from the same PRF output', async () => {
      const prf = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const vk = await generateVaultKey();
      const kek1 = await deriveKekFromPrf(prf);
      const wrapped = await wrapVaultKey(vk, kek1);
      const kek2 = await deriveKekFromPrf(prf);          // re-derive
      const vk2 = await unwrapVaultKey(wrapped, kek2);
      const ct = await encrypt(vk, 'bio-secret');
      expect(await decrypt(vk2, ct)).toBe('bio-secret');
    });

    it('different PRF outputs produce non-interoperable KEKs', async () => {
      const vk = await generateVaultKey();
      const wrapped = await wrapVaultKey(vk, await deriveKekFromPrf(crypto.getRandomValues(new Uint8Array(32)).buffer));
      await expect(
        unwrapVaultKey(wrapped, await deriveKekFromPrf(crypto.getRandomValues(new Uint8Array(32)).buffer)),
      ).rejects.toThrow();
    });
  });
  ```
- [ ] Ejecutar `pnpm test tests/webauthn/kek-bio.test.ts` → FAIL.
- [ ] Implementar `lib/webauthn/kek-bio.ts` con HKDF-SHA256 → AES-KW key:
  ```ts
  const HKDF_INFO = new TextEncoder().encode('orbit-bio-kek-v1');
  const HKDF_SALT = new TextEncoder().encode('orbit-bio-hkdf-salt-v1');

  /**
   * Derive KEK_bio from a WebAuthn PRF output via HKDF-SHA256, imported as an
   * AES-KW key for wrapping/unwrapping the VaultKey. The PRF output is the IKM.
   */
  export async function deriveKekFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
    const ikm = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
      ikm,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }
  ```
- [ ] Ejecutar `pnpm test tests/webauthn/kek-bio.test.ts` → PASS.
- [ ] Commit: `feat(webauthn): HKDF-SHA256 KEK_bio derivation from PRF output`.

### Task 9: Enrolamiento WebAuthn PRF (create + segunda copia de VaultKey)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/webauthn/enroll.ts` (nuevo)

- [ ] Implementar `lib/webauthn/enroll.ts`. `enrollBiometric(vaultKey)` corre `navigator.credentials.create` con `userVerification: "required"`, `authenticatorAttachment: "platform"`, `residentKey: "preferred"`, y la extensión `prf` con `eval.first` = salt de la app. **Crítico (anti gate-booleano):** si `getClientExtensionResults().prf?.results?.first` viene vacío, NO se enrola — se lanza error y se muestra mensaje (spec §3.6). Solo si hay PRF se deriva KEK_bio, se envuelve la VaultKey y se guarda `BioCredential` en IndexedDB:
  ```ts
  import { repository } from '@/lib/db/repository';
  import { wrapVaultKey } from '@/lib/crypto/envelope';
  import { deriveKekFromPrf } from './kek-bio';
  import { APP_PRF_SALT_B64 } from './support';
  import { fromBase64, toBase64 } from '@/lib/crypto/vault';
  import type { BioCredential } from '@/lib/types';

  function toBase64Url(bytes: Uint8Array): string {
    return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  export class PrfUnsupportedError extends Error {
    constructor() { super('Authenticator did not return a PRF result'); this.name = 'PrfUnsupportedError'; }
  }

  /**
   * Enroll a platform passkey and wrap a second copy of VaultKey under KEK_bio.
   * Requires an UNLOCKED vault (the live VaultKey). Throws PrfUnsupportedError if
   * the browser/authenticator does not deliver a PRF result at creation time —
   * in that case NOTHING is persisted (no biometric unlock without PRF).
   */
  export async function enrollBiometric(vaultKey: CryptoKey): Promise<BioCredential> {
    const prfSalt = fromBase64(APP_PRF_SALT_B64);
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Orbit', id: location.hostname },
        user: { id: userId, name: 'orbit-vault', displayName: 'Orbit Vault' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!cred) throw new PrfUnsupportedError();

    const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
    const prfFirst = ext.prf?.results?.first;
    if (!prfFirst) {
      // Some platforms only report prf.enabled at create() and require a follow-up
      // get() to obtain results. We choose the strict path: if no PRF output here,
      // do not enroll. UI will instruct the user that biometrics are unavailable.
      throw new PrfUnsupportedError();
    }

    const kekBio = await deriveKekFromPrf(prfFirst);
    const wrappedVaultKey = await wrapVaultKey(vaultKey, kekBio);

    const bio: BioCredential = {
      credentialId: toBase64Url(new Uint8Array(cred.rawId)),
      prfSalt: APP_PRF_SALT_B64,
      wrappedVaultKey,
      createdAt: new Date().toISOString(),
    };
    await repository.saveBio(bio);
    return bio;
  }

  export async function revokeBiometric(): Promise<void> {
    await repository.deleteBio();
  }

  export async function isBiometricEnrolled(): Promise<boolean> {
    return (await repository.getBio()) !== undefined;
  }
  ```
- [ ] **Nota sobre el caso "prf.enabled pero sin results en create()":** documentado arriba. Algunas plataformas (ciertas versiones de Safari) solo entregan PRF en `get()`. La decisión del plan es la ruta estricta (no enrolar). Si en S9b real se observa que un objetivo importante requiere el follow-up `get()`, registrar un `/learn` y abrir tarea de seguimiento — NO relajar a un gate booleano.
- [ ] No hay test unit aislado de `enroll` (depende de `navigator.credentials.create`, cubierto por el E2E con virtual authenticator en Task 13). Ejecutar `pnpm exec tsc --noEmit` → 0 errores.
- [ ] Commit: `feat(webauthn): biometric enrollment (create + wrap VaultKey under KEK_bio)`.

### Task 10: Unlock biométrico (get + PRF → unwrap VaultKey)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/webauthn/unlock.ts` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/store/vault-store.ts`

- [ ] Implementar `lib/webauthn/unlock.ts`. `unlockBiometric()` lee `BioCredential`, corre `navigator.credentials.get` con `userVerification: "required"`, `allowCredentials` apuntando al credentialId, extensión `prf.eval.first` con el salt guardado; deriva KEK_bio, **desenvuelve** la VaultKey, valida verifier, descifra el blob:
  ```ts
  import { repository } from '@/lib/db/repository';
  import { unwrapVaultKey } from '@/lib/crypto/envelope';
  import { deriveKekFromPrf } from './kek-bio';
  import { decrypt, checkVerifier, fromBase64 } from '@/lib/crypto/vault';
  import type { VaultData } from '@/lib/types';
  import type { VaultSession } from '@/lib/services/vault-service';

  function fromBase64Url(s: string): Uint8Array {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    return fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  }

  const emptyData = (): VaultData => ({ subscriptions: [], credentials: [], paymentMethods: [] });

  export class BiometricUnavailableError extends Error {
    constructor(msg = 'Biometric unlock unavailable') { super(msg); this.name = 'BiometricUnavailableError'; }
  }

  /** Unlock the vault via a platform passkey + PRF. Throws if not enrolled or PRF missing. */
  export async function unlockBiometric(): Promise<VaultSession> {
    const bio = await repository.getBio();
    if (!bio) throw new BiometricUnavailableError('Not enrolled');

    const meta = await repository.getMeta();
    if (!meta || meta.envelopeVersion === undefined) {
      throw new BiometricUnavailableError('Vault not in envelope format');
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(bio.credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: fromBase64(bio.prfSalt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) throw new BiometricUnavailableError('No assertion');
    const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
    const prfFirst = ext.prf?.results?.first;
    if (!prfFirst) throw new BiometricUnavailableError('No PRF result');

    const kekBio = await deriveKekFromPrf(prfFirst);
    let vaultKey: CryptoKey;
    try {
      vaultKey = await unwrapVaultKey(bio.wrappedVaultKey, kekBio);
    } catch {
      throw new BiometricUnavailableError('Could not unwrap VaultKey');
    }
    if (!(await checkVerifier(vaultKey, meta.verifier))) throw new BiometricUnavailableError('Verifier mismatch');

    const blob = await repository.getEncryptedData();
    const data: VaultData = blob ? JSON.parse(await decrypt(vaultKey, blob)) : emptyData();
    return { key: vaultKey, data };
  }
  ```
- [ ] En `lib/store/vault-store.ts`: añadir `unlockBio` al interface y a la implementación, espejo de `unlock` pero usando `unlockBiometric()`:
  ```ts
  // en VaultState:
  unlockBio: () => Promise<void>;
  // en la implementación del store:
  async unlockBio() {
    const { unlockBiometric } = await import('@/lib/webauthn/unlock');
    const { key, data } = await unlockBiometric();
    set({ key, data, locked: false });
  },
  ```
- [ ] Ejecutar `pnpm exec tsc --noEmit` → 0 errores. (Cobertura funcional vía E2E Task 13.)
- [ ] Commit: `feat(webauthn): biometric unlock (get + PRF -> unwrap VaultKey) + store.unlockBio`.

### Task 11: i18n — strings es/en para Settings (biometría) y unlock

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/lib/i18n/dict.ts`

- [ ] En `lib/i18n/dict.ts`, dentro del bloque `en` (antes del `} as const;` de la línea ~246), añadir el namespace `settings.bio.*` y `unlock.bio*`:
  ```ts
  // ── Biometric unlock ────────────────────────────────────────────────────────
  'settings.bioTitle':            'Biometric unlock',
  'settings.bioDesc':             'Unlock with Face ID or your fingerprint on this device. Your master password still works as a fallback.',
  'settings.bioEnable':           'Enable biometric unlock',
  'settings.bioEnabling':         'Setting up…',
  'settings.bioEnabled':          'Biometric unlock is on for this device',
  'settings.bioDisable':          'Remove biometric unlock',
  'settings.bioDisabling':        'Removing…',
  'settings.bioUnsupported':      'This device or browser does not support biometric unlock.',
  'settings.bioPrfUnsupported':   'Your device set up a passkey but did not provide the secure key material (PRF) Orbit needs. Biometric unlock is unavailable here.',
  'settings.bioError':            'Could not set up biometric unlock. Please try again.',
  'settings.bioRevoked':          'Biometric unlock removed from this device.',
  ```
  Y en el namespace `unlock.*`:
  ```ts
  'unlock.bioButton':             'Unlock with Face ID / fingerprint',
  'unlock.bioWorking':            'Waiting for biometrics…',
  'unlock.bioError':              'Biometric unlock failed. Use your master password.',
  'unlock.orPassword':            'or enter your master password',
  ```
- [ ] En el bloque `es` (antes del `} as const;` de la línea ~485), añadir las traducciones exactas:
  ```ts
  // ── Desbloqueo biométrico ────────────────────────────────────────────────────
  'settings.bioTitle':            'Desbloqueo biométrico',
  'settings.bioDesc':             'Desbloquea con Face ID o tu huella en este dispositivo. Tu contraseña maestra sigue funcionando como alternativa.',
  'settings.bioEnable':           'Activar desbloqueo biométrico',
  'settings.bioEnabling':         'Configurando…',
  'settings.bioEnabled':          'El desbloqueo biométrico está activo en este dispositivo',
  'settings.bioDisable':          'Quitar desbloqueo biométrico',
  'settings.bioDisabling':        'Quitando…',
  'settings.bioUnsupported':      'Este dispositivo o navegador no admite el desbloqueo biométrico.',
  'settings.bioPrfUnsupported':   'Tu dispositivo creó una clave de acceso pero no entregó el material criptográfico (PRF) que Orbit necesita. El desbloqueo biométrico no está disponible aquí.',
  'settings.bioError':            'No se pudo configurar el desbloqueo biométrico. Inténtalo de nuevo.',
  'settings.bioRevoked':          'Desbloqueo biométrico eliminado de este dispositivo.',
  ```
  Y en el namespace `unlock.*` del bloque `es`:
  ```ts
  'unlock.bioButton':             'Desbloquear con Face ID / huella',
  'unlock.bioWorking':            'Esperando biometría…',
  'unlock.bioError':              'El desbloqueo biométrico falló. Usa tu contraseña maestra.',
  'unlock.orPassword':            'o ingresa tu contraseña maestra',
  ```
- [ ] Ejecutar `pnpm exec tsc --noEmit` → 0 errores (las claves nuevas deben existir en `en` para que `DictKey` las incluya; `es` se castea al tipo suelto).
- [ ] Commit: `feat(i18n): biometric unlock strings (es/en) for settings and unlock`.

### Task 12: UI — toggle de biometría en Settings (estados) + botón en /unlock

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/components/settings/BiometricToggle.tsx` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/app/(vault)/settings/page.tsx`
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/app/unlock/page.tsx`

- [ ] Crear `components/settings/BiometricToggle.tsx` — client component con tres estados: (a) no soportado → no renderiza nada (`return null`); (b) soportado no enrolado → botón "Activar"; (c) enrolado → estado activo + botón "Quitar". Usa la VaultKey viva (`vaultStore.getState().key`) para enrolar. Target ≥44px (gate a11y del proyecto):
  ```tsx
  'use client';

  import * as React from 'react';
  import { Fingerprint, ShieldCheck } from 'lucide-react';
  import { Button } from '@/components/ui/button';
  import { vaultStore } from '@/lib/store/vault-store';
  import { useT } from '@/lib/i18n/use-t';
  import { isPlatformAuthenticatorMaybeAvailable } from '@/lib/webauthn/support';
  import { enrollBiometric, revokeBiometric, isBiometricEnrolled, PrfUnsupportedError } from '@/lib/webauthn/enroll';

  type Phase = 'checking' | 'unsupported' | 'idle' | 'enrolled' | 'working';

  export function BiometricToggle() {
    const t = useT();
    const [phase, setPhase] = React.useState<Phase>('checking');
    const [error, setError] = React.useState('');

    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        const supported = await isPlatformAuthenticatorMaybeAvailable();
        if (cancelled) return;
        if (!supported) { setPhase('unsupported'); return; }
        setPhase((await isBiometricEnrolled()) ? 'enrolled' : 'idle');
      })();
      return () => { cancelled = true; };
    }, []);

    async function handleEnable() {
      setError('');
      const key = vaultStore.getState().key;
      if (!key) return;
      setPhase('working');
      try {
        await enrollBiometric(key);
        setPhase('enrolled');
      } catch (err) {
        setPhase('idle');
        setError(err instanceof PrfUnsupportedError ? t('settings.bioPrfUnsupported') : t('settings.bioError'));
      }
    }

    async function handleDisable() {
      setError('');
      setPhase('working');
      try {
        await revokeBiometric();
        setPhase('idle');
      } catch {
        setPhase('enrolled');
        setError(t('settings.bioError'));
      }
    }

    if (phase === 'checking' || phase === 'unsupported') return null;

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{t('settings.bioTitle')}</span>
          <span className="text-xs text-muted-foreground">{t('settings.bioDesc')}</span>
        </div>

        {phase === 'enrolled' ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              <ShieldCheck aria-hidden className="size-4 text-emerald-500" />
              {t('settings.bioEnabled')}
            </p>
            <Button variant="outline" className="self-start gap-2 h-11" onClick={handleDisable} disabled={phase !== 'enrolled'}>
              {t('settings.bioDisable')}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="self-start gap-2 h-11"
            onClick={handleEnable}
            disabled={phase === 'working'}
            aria-busy={phase === 'working'}
          >
            <Fingerprint aria-hidden className="size-4" />
            {phase === 'working' ? t('settings.bioEnabling') : t('settings.bioEnable')}
          </Button>
        )}

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  ```
- [ ] En `app/(vault)/settings/page.tsx`: importar y montar el toggle dentro de una nueva `<Section>` (después de "Backup & Restore", antes de "Danger zone"):
  ```tsx
  import { BiometricToggle } from '@/components/settings/BiometricToggle';
  // ... en el JSX, entre la Section de backup y la danger zone:
  <Section title={t('settings.bioTitle')}>
    <BiometricToggle />
  </Section>
  ```
  Nota: el componente devuelve `null` cuando no hay soporte; la Section quedaría vacía. Para evitar una tarjeta vacía, mover el `<Section>` dentro de un wrapper que solo renderice cuando soportado — alternativa simple: que `BiometricToggle` renderice su propia `<Section>`. Implementar así: extraer la `Section` interna al componente (pasarle `title`) y en la página montar solo `<BiometricToggle />` sin envolver, devolviendo `null` ocultando toda la sección cuando no soportado. Ajustar el componente para incluir su propia `<section>` con el mismo estilo que `Section` (rounded-2xl border bg-card px-5 py-5).
- [ ] En `app/unlock/page.tsx`: añadir el botón biométrico que aparece **solo si hay enrolamiento**. Estado local `bioAvailable`; en `useEffect` consultar `isBiometricEnrolled()`. Handler llama `vaultStore.getState().unlockBio()` y enruta a `/dashboard`; en error muestra `t('unlock.bioError')` y deja el form de password visible:
  ```tsx
  // imports añadidos:
  import { Fingerprint } from 'lucide-react';
  import { isBiometricEnrolled } from '@/lib/webauthn/enroll';

  // estado:
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isBiometricEnrolled().then((on) => { if (!cancelled) setBioAvailable(on); });
    return () => { cancelled = true; };
  }, []);

  async function handleBio() {
    setBioBusy(true);
    setError('');
    try {
      await vaultStore.getState().unlockBio();
      await settingsStore.getState().loadSettings();
      router.replace('/dashboard');
    } catch {
      setError(t('unlock.bioError'));
      setBioBusy(false);
    }
  }
  ```
  Y en el JSX, encima del `<form>` (Face ID primero, password como fallback debajo), renderizar solo si `bioAvailable`:
  ```tsx
  {bioAvailable && (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="w-full h-11 gap-2"
        onClick={handleBio}
        disabled={bioBusy}
        aria-busy={bioBusy}
      >
        <Fingerprint size={16} aria-hidden />
        {bioBusy ? t('unlock.bioWorking') : t('unlock.bioButton')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('unlock.orPassword')}</p>
    </div>
  )}
  ```
- [ ] Ejecutar `pnpm exec tsc --noEmit` y `pnpm lint` → limpio.
- [ ] Commit: `feat(ui): biometric toggle in settings + Face ID button on unlock`.

### Task 13: E2E Playwright con virtual authenticator (CDP, hasPrf)

**Files:**
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/e2e/helpers/webauthn.ts` (nuevo)
- `/Users/samu/code/personal/Mark-IV-Ach/orbit/e2e/biometric.spec.ts` (nuevo)

- [ ] Escribir el helper completo `e2e/helpers/webauthn.ts` que habilita un authenticator virtual con PRF vía CDP (Chrome):
  ```ts
  import type { Page } from '@playwright/test';

  export interface VirtualAuthenticator {
    authenticatorId: string;
    dispose: () => Promise<void>;
  }

  /**
   * Install a virtual platform authenticator with PRF + UV support via Chrome DevTools Protocol.
   * Returns a handle to remove it afterwards. Chrome-only (the e2e projects use channel: 'chrome').
   */
  export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
    const client = await page.context().newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',          // platform authenticator
        hasResidentKey: true,
        hasUserVerification: true,
        hasPrf: true,                   // <-- enables the PRF extension
        isUserVerified: true,           // auto-pass UV (no real biometric prompt)
        automaticPresenceSimulation: true,
      },
    });
    return {
      authenticatorId,
      dispose: async () => {
        try { await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }); } catch { /* noop */ }
      },
    };
  }
  ```
- [ ] Escribir `e2e/biometric.spec.ts`. Reusar helpers de `orbit.spec.ts` (copiar `createVault`/`goToSettings`/`unlockVault` o importarlos si se exportan — más simple: duplicar las constantes mínimas y los pasos). Flujo: crear bóveda → instalar authenticator virtual → ir a Settings → activar biometría → recargar (locks) → en /unlock pulsar el botón Face ID → llegar a /dashboard:
  ```ts
  import { test, expect } from '@playwright/test';
  import { addVirtualAuthenticator } from './helpers/webauthn';

  const MASTER_PASSWORD = 'TestPassword1!';

  async function createVault(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.waitForURL('**/onboarding', { timeout: 15_000 });
    await page.getByLabel('Master password').first().fill(MASTER_PASSWORD);
    await page.getByLabel('Confirm password').fill(MASTER_PASSWORD);
    await page.getByRole('button', { name: /create vault/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  }

  async function goToSettings(page: import('@playwright/test').Page) {
    await page.getByRole('link', { name: /^settings$/i }).filter({ visible: true }).click();
    await page.waitForURL('**/settings', { timeout: 10_000 });
  }

  test('enroll biometrics, lock, unlock via Face ID button', async ({ page }) => {
    const authenticator = await addVirtualAuthenticator(page);
    try {
      await createVault(page);
      await goToSettings(page);

      // Enroll
      await page.getByRole('button', { name: /enable biometric unlock|activar desbloqueo/i }).click();
      await expect(page.getByText(/biometric unlock is on|desbloqueo biométrico está activo/i)).toBeVisible({ timeout: 15_000 });

      // Lock by reload, then unlock via biometric button
      await page.reload();
      await page.waitForURL('**/unlock', { timeout: 15_000 });
      const bioBtn = page.getByRole('button', { name: /face id|huella/i });
      await expect(bioBtn).toBeVisible({ timeout: 10_000 });
      await bioBtn.click();
      await page.waitForURL('**/dashboard', { timeout: 20_000 });
    } finally {
      await authenticator.dispose();
    }
  });

  test('revoke biometrics hides the Face ID button on unlock', async ({ page }) => {
    const authenticator = await addVirtualAuthenticator(page);
    try {
      await createVault(page);
      await goToSettings(page);
      await page.getByRole('button', { name: /enable biometric unlock|activar desbloqueo/i }).click();
      await expect(page.getByText(/biometric unlock is on|desbloqueo biométrico está activo/i)).toBeVisible({ timeout: 15_000 });

      // Revoke
      await page.getByRole('button', { name: /remove biometric unlock|quitar desbloqueo/i }).click();
      await expect(page.getByRole('button', { name: /enable biometric unlock|activar desbloqueo/i })).toBeVisible({ timeout: 10_000 });

      // Lock + unlock: no biometric button should be present
      await page.reload();
      await page.waitForURL('**/unlock', { timeout: 15_000 });
      await expect(page.getByRole('button', { name: /face id|huella/i })).toHaveCount(0);
      // Password fallback still works
      await page.getByLabel('Master password').fill(MASTER_PASSWORD);
      await page.getByRole('button', { name: /unlock vault/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 20_000 });
    } finally {
      await authenticator.dispose();
    }
  });
  ```
  Nota: el authenticator virtual usa `rp.id = location.hostname` → en E2E es `localhost`, que WebAuthn trata como origen seguro. Si `addVirtualAuthenticator` falla en el proyecto `desktop` vs `mobile`, restringir el spec con `test.describe.configure` o un `test.skip(({ browserName }) => ...)`; ambos proyectos usan `channel: 'chrome'` así que CDP está disponible.
- [ ] Ejecutar `pnpm test:e2e e2e/biometric.spec.ts` → ambos tests PASS (Playwright hará `pnpm build && pnpm start`). Si el build falla por WebCrypto/CSP, revisar que la CSP ya permite `wasm-unsafe-eval` (commit reciente) — AES-KW/HKDF no requieren wasm.
- [ ] Commit: `test(e2e): biometric enroll/unlock/revoke with virtual authenticator (PRF)`.

### Task 14: Gates y cierre

**Files:** (todos los anteriores)

- [ ] **`/security-review` (OBLIGATORIO — crypto):** auditar `lib/crypto/envelope.ts`, `lib/services/vault-migration.ts`, `lib/webauthn/kek-bio.ts`, `lib/webauthn/enroll.ts`, `lib/webauthn/unlock.ts`. Checklist específico: (1) VaultKey nunca persiste sin envolver (verificar que NO se escribe `exportVaultKeyRaw` a IndexedDB en ningún path — anti gate-booleano); (2) AES-KW rechaza KEK incorrecta antes de tocar el blob; (3) la migración no deja la bóveda en estado intermedio si falla a mitad (transacción Dexie); (4) el verifier valida tras todo unwrap; (5) `prfSalt` no es un secreto y está bien que viaje en IndexedDB, pero `wrappedVaultKey` jamás debe salir en un backup export (confirmar que `exportBackup` solo toca `meta`+`blob`, no `bio`); (6) `rp.id`/`hostname` correcto, `userVerification: 'required'` en create y get. Resolver todo hallazgo bloqueante.
- [ ] **`/code-review`:** sobre el diff completo de S9 (efecto medium/high).
- [ ] **`typescript-reviewer`:** sobre los `.ts/.tsx` nuevos y modificados (envelope, webauthn/*, vault-service, store, settings page, unlock page, dict).
- [ ] **`/impeccable audit` + screenshots Playwright:** capturar (a) Settings con el toggle biométrico en estado "idle" y en estado "enrolled"; (b) `/unlock` con el botón Face ID visible. Verificar jerarquía visual, targets ≥44px, contraste, i18n es/en. Guardar capturas y adjuntarlas.
- [ ] **Verificación final (superpowers:verification-before-completion):** `pnpm test` (toda la suite — crypto/envelope, migration, vault-service, backup, repository, webauthn/*), `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test:e2e` → TODO verde con evidencia pegada antes de declarar completo.
- [ ] Confirmar manualmente (o documentar como limitación aceptada del spec §3.6) que en un navegador sin PRF el toggle queda oculto y el unlock no muestra botón biométrico.
- [ ] Commit final de cierre si quedan cambios sin commitear (p.ej. screenshots/docs). **El redactor NO commitea**; el ejecutor sí, tarea por tarea.
- [ ] `/compact`.

---

## Notas de riesgo y limitaciones (spec §3.6, aceptadas)

- Borrar datos del navegador elimina `bio` → re-enrolar (la bóveda sigue abriéndose con master password).
- Passkeys no interoperan entre ecosistemas Apple/Google; biometría es por-dispositivo (no se sincroniza vía sync de S6, que solo mueve el blob cifrado + `meta`).
- WebAuthn no funciona en in-app browsers; Firefox móvil sin soporte → toggle oculto.
- `APP_PRF_SALT_B64` es fijo y público por diseño; el secreto vive en el authenticator. Rotarlo invalidaría enrolamientos existentes (forzaría re-enrolar) — por eso se guarda `prfSalt` por credencial.
