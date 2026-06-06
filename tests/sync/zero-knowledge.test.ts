// tests/sync/zero-knowledge.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
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
