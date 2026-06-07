// e2e/multi-device.spec.ts
/**
 * Multi-device parity E2E (CP4 + CP7 / spec §5.7).
 *
 * Two browser contexts = two devices with isolated IndexedDB, same Supabase
 * account. Exercises the SINGLE sync code path (no platform branches):
 *   A: creates vault + subscription (debounced push → flushed on pagehide)
 *   B: opens /link → enters the SAME master password → sees A's subscription
 *   B: edits (adds another) → push
 *   A: reload → unlock → reconcileNow pulls → converges (sees B's edit)
 *
 * The second test (S12) covers the offline/reconnect criterion:
 *   B offline → A edits → B reconnects → converges (no local edits), then
 *   B offline + BOTH edit → B reconnects → conflict dialog → resolve → parity.
 *
 * Preconditions (the tests self-skip when unmet):
 *   - NEXT_PUBLIC_SYNC_ENABLED=true exported when running Playwright — the
 *     webServer config forwards it into the prod build (NEXT_PUBLIC_* inlines).
 *     If a server from a previous run is still up (reuseExistingServer), kill it
 *     first or the flag won't be in the served bundle.
 *   - Supabase project reachable with the email provider + autoconfirm enabled:
 *     each test signs up a throwaway user per run via the REST API (anon key) and
 *     injects the session as the @supabase/ssr auth cookie in both contexts —
 *     no Google OAuth needed. Real RLS, real upsert_vault, real ciphertext.
 *     Setup/teardown details: docs/manual-checklists/s12-e2e.md.
 */

import { test, expect } from '@playwright/test';
import {
  syncEnabled, loadSupabaseEnv, signUpTestUser, injectSession,
  waitForRemoteVersion, deleteRemoteVault,
  createVaultOn, linkDeviceOn, gotoSubscriptions, addSubscriptionOn,
  flushPush, triggerReconcile, MASTER_PASSWORD,
} from './helpers/multi-device';

const SERVICE_A = 'Netflix';
const SERVICE_B = 'Spotify';
const SERVICE_C = 'Disney Plus';
const SERVICE_D = 'HBO Max';

test('multi-device parity: A creates, B links and sees data, B edits, A converges', async ({ browser }, testInfo) => {
  test.skip(!syncEnabled, 'requires NEXT_PUBLIC_SYNC_ENABLED=true exported for the webServer build');
  test.setTimeout(180_000);

  const { url, anonKey } = loadSupabaseEnv();
  expect(url, 'NEXT_PUBLIC_SUPABASE_URL must be available (env or .env.local)').toBeTruthy();
  const session = await signUpTestUser(url, anonKey, testInfo.project.name);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    // ── Device A ─────────────────────────────────────────────────────────────
    await injectSession(ctxA, url, session);
    const pageA = await ctxA.newPage();
    await createVaultOn(pageA); // initial backup push is scheduled on creation
    await addSubscriptionOn(pageA, SERVICE_A); // mutation → debounced push
    await flushPush(pageA);
    const versionAfterA = await waitForRemoteVersion(url, anonKey, session.access_token, 1);

    // ── Device B (same account, isolated IndexedDB) ──────────────────────────
    await injectSession(ctxB, url, session);
    const pageB = await ctxB.newPage();
    // New device lands on /link (post-OAuth redirect target when sync is on).
    // detect() → remote-only → password prompt; same master password as A.
    await linkDeviceOn(pageB);
    // B sees A's subscription — pulled, decrypted client-side, hydrated.
    await gotoSubscriptions(pageB);
    await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 10_000 });

    // ── B edits → push ────────────────────────────────────────────────────────
    await addSubscriptionOn(pageB, SERVICE_B);
    await flushPush(pageB);
    await waitForRemoteVersion(url, anonKey, session.access_token, versionAfterA + 1);

    // ── A converges: reload → unlock → reconcileNow pulls remote ─────────────
    await pageA.reload();
    await pageA.waitForURL('**/unlock', { timeout: 15_000 });
    await pageA.getByLabel('Master password').fill(MASTER_PASSWORD);
    await pageA.getByRole('button', { name: /unlock vault/i }).click();
    await pageA.waitForURL('**/dashboard', { timeout: 20_000 });
    await gotoSubscriptions(pageA);
    // A sees BOTH subscriptions: its own and B's.
    await expect(pageA.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByRole('button', { name: new RegExp(SERVICE_B, 'i') })).toBeVisible({ timeout: 15_000 });
  } finally {
    // Teardown also on failure: drop the remote row (RLS allows own-row delete)
    // and close both contexts so a flake leaves no residue.
    await deleteRemoteVault(url, anonKey, session).catch(() => {});
    await ctxA.close();
    await ctxB.close();
  }
});

test('offline device reconnects: fast-forward converge without local edits; conflict dialog with them', async ({ browser }, testInfo) => {
  test.skip(!syncEnabled, 'requires NEXT_PUBLIC_SYNC_ENABLED=true exported for the webServer build');
  test.setTimeout(240_000);

  const { url, anonKey } = loadSupabaseEnv();
  expect(url, 'NEXT_PUBLIC_SUPABASE_URL must be available (env or .env.local)').toBeTruthy();
  const session = await signUpTestUser(url, anonKey, `${testInfo.project.name}-off`);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    // Setup: A creates the vault, B links (both online, converged at v≥1).
    await injectSession(ctxA, url, session);
    const pageA = await ctxA.newPage();
    await createVaultOn(pageA);
    await addSubscriptionOn(pageA, SERVICE_A);
    await flushPush(pageA);
    const v1 = await waitForRemoteVersion(url, anonKey, session.access_token, 1);

    await injectSession(ctxB, url, session);
    const pageB = await ctxB.newPage();
    await linkDeviceOn(pageB);
    await gotoSubscriptions(pageB);
    await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 10_000 });

    // ── Phase 1: B offline, NO local edits → reconnect → fast-forward pull ───
    await ctxB.setOffline(true);
    await addSubscriptionOn(pageA, SERVICE_B);
    await flushPush(pageA);
    const v2 = await waitForRemoteVersion(url, anonKey, session.access_token, v1 + 1);

    await ctxB.setOffline(false);
    await triggerReconcile(pageB);
    // remote.version > local.version, no local mutation → reconcile = pull.
    await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_B, 'i') })).toBeVisible({ timeout: 20_000 });

    // ── Phase 2: A pushes FIRST, then B edits offline → conflict on reconnect ─
    // reconcile() flags conflict when remote advanced AND local.updatedAt >
    // remote.updatedAt — so A's push must land before B's offline edit.
    // Assumes the Supabase server clock is not ahead of this machine's clock
    // (local.updatedAt is browser wall-clock; remote.updated_at is server now()).
    // Both contexts share one clock here, so ordering is deterministic.
    await addSubscriptionOn(pageA, SERVICE_C);
    await flushPush(pageA);
    await waitForRemoteVersion(url, anonKey, session.access_token, v2 + 1);

    await ctxB.setOffline(true);
    await addSubscriptionOn(pageB, SERVICE_D); // local mutation, push cannot land
    await ctxB.setOffline(false);
    await triggerReconcile(pageB);

    // Conflict dialog (components/sync/conflict-dialog.tsx, i18n sync.conflict*).
    await expect(pageB.getByText(/changed on another device|cambió en otro dispositivo/i)).toBeVisible({ timeout: 20_000 });
    // Resolve: use the other device (remote wins) → B converges to A's state.
    await pageB.getByRole('button', { name: /use the other device|usar el otro dispositivo/i }).click();
    await gotoSubscriptions(pageB);
    await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_C, 'i') })).toBeVisible({ timeout: 20_000 });
    // B's offline-only edit was replaced by the chosen remote version.
    await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_D, 'i') })).toHaveCount(0);
  } finally {
    // Teardown also on failure — no remote rows or contexts left behind.
    await deleteRemoteVault(url, anonKey, session).catch(() => {});
    await ctxA.close();
    await ctxB.close();
  }
});
