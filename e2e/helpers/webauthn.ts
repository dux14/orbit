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
