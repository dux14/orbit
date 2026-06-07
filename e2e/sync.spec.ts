// e2e/sync.spec.ts
/**
 * Encrypted sync flow E2E (CP7) — the parts NOT covered by multi-device.spec.ts:
 *   - sign-out clears the Supabase session; a full navigation afterwards lands
 *     on /unlock (vault key lives only in memory — local-first lock semantics).
 *   - cloud reminders toggle ON writes push_subscriptions + reminders index
 *     rows server-side; toggle OFF deletes them (verified via REST with the
 *     user's own session — RLS scopes to own rows).
 *
 * Already covered in multi-device.spec.ts (do not duplicate):
 *   - local vault links/uploads on (seeded) sign-in — device A path.
 *   - new device pulls remote vault and unlocks with the same password — /link.
 *
 * Same preconditions as multi-device.spec.ts: NEXT_PUBLIC_SYNC_ENABLED=true,
 * throwaway user per run, seeded @supabase/ssr cookie. See
 * docs/manual-checklists/s12-e2e.md for setup/teardown details.
 */

import { test, expect } from '@playwright/test';
import {
  syncEnabled, loadSupabaseEnv, signUpTestUser, injectSession,
  deleteRemoteVault, createVaultOn, addSubscriptionOn, gotoSettings,
  flushPush, waitForRemoteVersion, type TestSession,
} from './helpers/multi-device';

const SERVICE = 'Netflix';

async function countRows(
  url: string, anonKey: string, session: TestSession, table: 'push_subscriptions' | 'reminders',
): Promise<number> {
  const res = await fetch(`${url}/rest/v1/${table}?select=user_id`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
  });
  const rows = (await res.json()) as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}

test('sign-out clears the session and a fresh navigation lands on /unlock', async ({ browser }, testInfo) => {
  test.skip(!syncEnabled, 'requires NEXT_PUBLIC_SYNC_ENABLED=true exported for the webServer build');
  test.setTimeout(120_000);

  const { url, anonKey } = loadSupabaseEnv();
  expect(url, 'NEXT_PUBLIC_SUPABASE_URL must be available (env or .env.local)').toBeTruthy();
  const session = await signUpTestUser(url, anonKey, `${testInfo.project.name}-so`);

  const ctx = await browser.newContext();
  try {
    await injectSession(ctx, url, session);
    const page = await ctx.newPage();
    await createVaultOn(page);

    // Signed-in state visible in Settings → sign out.
    await gotoSettings(page);
    await expect(page.getByText(/signed in as|sesión iniciada como/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /sign out|cerrar sesión/i }).click();
    // Session cleared → the Account section offers Google sign-in again.
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible({ timeout: 15_000 });

    // Full navigation drops the in-memory vault key → /unlock (locked).
    await page.goto('/');
    await page.waitForURL('**/unlock', { timeout: 15_000 });
  } finally {
    // Teardown also on failure — no remote rows or contexts left behind.
    await deleteRemoteVault(url, anonKey, session).catch(() => {});
    await ctx.close();
  }
});

test('cloud reminders toggle writes the index server-side, then deletes it', async ({ browser }, testInfo) => {
  test.skip(!syncEnabled, 'requires NEXT_PUBLIC_SYNC_ENABLED=true exported for the webServer build');
  test.setTimeout(180_000);

  const { url, anonKey } = loadSupabaseEnv();
  expect(url, 'NEXT_PUBLIC_SUPABASE_URL must be available (env or .env.local)').toBeTruthy();
  const session = await signUpTestUser(url, anonKey, `${testInfo.project.name}-cr`);

  const ctx = await browser.newContext({ permissions: ['notifications'] });
  // Headless Chrome cannot reach a real push service (FCM), so stub ONLY the
  // browser↔push-service handshake (subscribe/getSubscription/unsubscribe).
  // Everything else stays real: RLS-scoped writes/deletes of
  // push_subscriptions and the reminders index. The real handshake + delivery
  // is covered on-device by docs/manual-checklists/s10-push.md.
  await ctx.addInitScript(() => {
    let current: PushSubscription | null = null;
    const makeFake = () => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-fake-${Math.random().toString(36).slice(2)}`;
      return {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BFakeP256dhKeyForE2eOnly', auth: 'fakeAuthE2e' } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      } as unknown as PushSubscription;
    };
    PushManager.prototype.subscribe = async function () {
      current = makeFake();
      return current;
    };
    PushManager.prototype.getSubscription = async function () {
      return current;
    };
  });
  try {
    await injectSession(ctx, url, session);
    const page = await ctx.newPage();
    await createVaultOn(page);
    await addSubscriptionOn(page, SERVICE); // gives the index something to mirror
    await flushPush(page);
    await waitForRemoteVersion(url, anonKey, session.access_token, 1);

    // The section renders only with a session + push support (SW + PushManager).
    await gotoSettings(page);
    const toggle = page.getByRole('switch', { name: /renewal reminders|recordatorios de renovación/i });
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // ── ON: registers push subscription + mirrors the minimal plaintext index ─
    await toggle.click();
    await expect(page.getByText(/cloud reminders are on|recordatorios en la nube activados/i)).toBeVisible({ timeout: 30_000 });
    expect(await countRows(url, anonKey, session, 'push_subscriptions')).toBeGreaterThanOrEqual(1);
    expect(await countRows(url, anonKey, session, 'reminders')).toBeGreaterThanOrEqual(1);

    // ── OFF: deletes subscription + index server-side ─────────────────────────
    await toggle.click();
    await expect(page.getByText(/index was deleted|índice se borró/i)).toBeVisible({ timeout: 30_000 });
    expect(await countRows(url, anonKey, session, 'push_subscriptions')).toBe(0);
    expect(await countRows(url, anonKey, session, 'reminders')).toBe(0);
  } finally {
    // Teardown also on failure — no remote rows or contexts left behind.
    await deleteRemoteVault(url, anonKey, session).catch(() => {});
    await ctx.close();
  }
});
