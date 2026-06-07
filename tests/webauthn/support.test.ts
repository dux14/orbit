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

  it('returns false when the availability check throws', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => { throw new Error('boom'); },
    });
    expect(await isPlatformAuthenticatorMaybeAvailable()).toBe(false);
  });

  it('exposes a fixed 32-byte app PRF salt', () => {
    expect(atob(APP_PRF_SALT_B64).length).toBe(32);
  });
});
