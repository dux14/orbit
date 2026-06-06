// tests/sync/apply-remote-verifier.test.ts
// Frontera de seguridad: applyRemote debe RECHAZAR un meta remoto cuyo verifier
// no descifra con la clave en memoria (vector meta/KDF swap: un atacante con
// escritura en la fila vaults podría degradar el KDF persistiendo meta ajeno).
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deriveKey, encrypt, defaultKdf, generateSalt, createVerifier } from '@/lib/crypto/vault';
import { applyRemote } from '@/lib/sync/sync-controller';
import { vaultStore } from '@/lib/store/vault-store';
import { db } from '@/lib/db/database';
import type { RemoteVault } from '@/lib/sync/types';

async function makeRemote(blobKey: CryptoKey, metaKey: CryptoKey, kdf: ReturnType<typeof defaultKdf> & { salt: string }): Promise<RemoteVault> {
  const data = { subscriptions: [], credentials: [], paymentMethods: [] };
  return {
    encryptedBlob: await encrypt(blobKey, JSON.stringify(data)),
    encryptedMeta: JSON.stringify({ schemaVersion: 1, kdf, verifier: await createVerifier(metaKey) }),
    version: 2,
    updatedAt: '2026-06-06T10:00:00.000Z',
  };
}

describe('applyRemote — verifier check (ZK meta-swap defence)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    vaultStore.getState().reset();
  });

  it('rejects a remote meta whose verifier does not match the in-memory key', async () => {
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const victimKey = await deriveKey('VictimPass1!', kdf);
    const attackerKey = await deriveKey('AttackerPass1!', { ...defaultKdf(), salt: generateSalt() });
    vaultStore.setState({ key: victimKey, locked: false });

    // Blob legítimo (descifra con la clave de la víctima) + meta envenenado.
    const remote = await makeRemote(victimKey, attackerKey, kdf);

    await expect(applyRemote(remote)).rejects.toThrow(/verifier/i);
    // El meta envenenado NO debe haberse persistido.
    expect(await db.meta.get('meta')).toBeUndefined();
  });

  it('applies a remote whose verifier matches the in-memory key', async () => {
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey('SamePass1!', kdf);
    vaultStore.setState({ key, locked: false });

    const remote = await makeRemote(key, key, kdf);

    await expect(applyRemote(remote)).resolves.toBeUndefined();
    expect(vaultStore.getState().data).toEqual({ subscriptions: [], credentials: [], paymentMethods: [] });
    expect(await db.meta.get('meta')).toBeDefined();
  });
});
