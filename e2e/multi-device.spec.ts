// e2e/multi-device.spec.ts
/**
 * Multi-device parity E2E (CP4 / spec §5.7).
 *
 * Two browser contexts = two devices with isolated IndexedDB, same Supabase
 * account. Exercises the SINGLE sync code path (no platform branches):
 *   A: creates vault + subscription (debounced push → flushed on pagehide)
 *   B: opens /link → enters the SAME master password → sees A's subscription
 *   B: edits (adds another) → push
 *   A: reload → unlock → reconcileNow pulls → converges (sees B's edit)
 *
 * Preconditions (the test self-skips when unmet):
 *   - NEXT_PUBLIC_SYNC_ENABLED=true exported when running Playwright — the
 *     webServer config forwards it into the prod build (NEXT_PUBLIC_* inlines).
 *     If a server from a previous run is still up (reuseExistingServer), kill it
 *     first or the flag won't be in the served bundle.
 *   - Supabase project reachable with the email provider + autoconfirm enabled:
 *     the test signs up a throwaway user per run via the REST API (anon key) and
 *     injects the session as the @supabase/ssr auth cookie in both contexts —
 *     no Google OAuth needed. Real RLS, real upsert_vault, real ciphertext.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MASTER_PASSWORD = 'TestPassword1!';
const SERVICE_A = 'Netflix';
const SERVICE_B = 'Spotify';

const syncEnabled = process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true';

// ── Env: Supabase URL + anon key (process.env first, .env.local fallback —
//    the Playwright runner does not load Next's dotenv files) ────────────────
function loadSupabaseEnv(): { url: string; anonKey: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) {
    try {
      const envFile = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
      for (const line of envFile.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m?.[1] === 'NEXT_PUBLIC_SUPABASE_URL' && !url) url = m[2].trim();
        if (m?.[1] === 'NEXT_PUBLIC_SUPABASE_ANON_KEY' && !anonKey) anonKey = m[2].trim();
      }
    } catch {
      // leave empty — the assertions below produce a clear failure message
    }
  }
  return { url, anonKey };
}

interface TestSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  user: { id: string };
}

/** Creates a unique throwaway user via REST signup (requires autoconfirm). */
async function signUpTestUser(url: string, anonKey: string, tag: string): Promise<TestSession> {
  const email = `e2e-${tag}-${Date.now()}@orbit-e2e.example.com`;
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'E2eMultiDevice9!' }),
  });
  const body = (await res.json()) as TestSession & { msg?: string };
  expect(body.access_token, `signup must return a session (got: ${body.msg ?? res.status})`).toBeTruthy();
  return body;
}

/**
 * Injects the session as the @supabase/ssr browser cookie:
 * name `sb-<project-ref>-auth-token`, value `base64-` + base64url(JSON),
 * chunked at 3180 chars (`.0`, `.1`, …) — mirrors createBrowserClient's storage.
 */
async function injectSession(ctx: BrowserContext, supabaseUrl: string, session: TestSession) {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const name = `sb-${ref}-auth-token`;
  const encoded =
    'base64-' +
    Buffer.from(JSON.stringify(session), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const MAX_CHUNK = 3180;
  const cookies: { name: string; value: string; domain: string; path: string }[] = [];
  if (encoded.length <= MAX_CHUNK) {
    cookies.push({ name, value: encoded, domain: 'localhost', path: '/' });
  } else {
    for (let i = 0; i * MAX_CHUNK < encoded.length; i++) {
      cookies.push({
        name: `${name}.${i}`,
        value: encoded.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK),
        domain: 'localhost',
        path: '/',
      });
    }
  }
  await ctx.addCookies(cookies);
}

/** Polls the remote vault row until its version reaches `minVersion`. */
async function waitForRemoteVersion(
  url: string,
  anonKey: string,
  accessToken: string,
  minVersion: number,
  timeoutMs = 30_000,
): Promise<number> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${url}/rest/v1/vaults?select=version`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });
    const rows = (await res.json()) as { version: number }[];
    const version = rows[0]?.version ?? 0;
    if (version >= minVersion) return version;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`remote vault did not reach version ${minVersion} in ${timeoutMs}ms (last: ${version})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ── UI helpers (selectors mirror e2e/orbit.spec.ts) ─────────────────────────
async function createVaultOn(page: Page) {
  await page.goto('/');
  await page.waitForURL('**/onboarding', { timeout: 15_000 });
  await page.getByLabel('Master password').first().fill(MASTER_PASSWORD);
  await page.getByLabel('Confirm password').fill(MASTER_PASSWORD);
  await page.getByRole('button', { name: /create vault/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

async function gotoSubscriptions(page: Page) {
  await page.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/subscriptions', { timeout: 10_000 });
}

async function addSubscriptionOn(page: Page, name: string) {
  await gotoSubscriptions(page);
  const addBtn = page
    .getByRole('button', { name: /add subscription/i })
    .or(page.getByRole('button', { name: /^add$/i }))
    .first();
  await addBtn.click();
  await page.getByLabel('Service name').fill(name);
  await page.getByLabel('Amount').fill('9.99');
  await page.getByLabel('Next renewal').fill('2026-12-31');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('button', { name: new RegExp(name, 'i') })).toBeVisible({ timeout: 10_000 });
}

/** Flush the debounced push (pagehide → SyncService.flush()) without unloading. */
async function flushPush(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
}

// ─────────────────────────────────────────────────────────────────────────────
test('multi-device parity: A creates, B links and sees data, B edits, A converges', async ({ browser }, testInfo) => {
  test.skip(!syncEnabled, 'requires NEXT_PUBLIC_SYNC_ENABLED=true exported for the webServer build');
  test.setTimeout(180_000);

  const { url, anonKey } = loadSupabaseEnv();
  expect(url, 'NEXT_PUBLIC_SUPABASE_URL must be available (env or .env.local)').toBeTruthy();
  const session = await signUpTestUser(url, anonKey, testInfo.project.name);

  // ── Device A ───────────────────────────────────────────────────────────────
  const ctxA = await browser.newContext();
  await injectSession(ctxA, url, session);
  const pageA = await ctxA.newPage();
  await createVaultOn(pageA); // initial backup push is scheduled on creation
  await addSubscriptionOn(pageA, SERVICE_A); // mutation → debounced push
  await flushPush(pageA);
  const versionAfterA = await waitForRemoteVersion(url, anonKey, session.access_token, 1);

  // ── Device B (same account, isolated IndexedDB) ────────────────────────────
  const ctxB = await browser.newContext();
  await injectSession(ctxB, url, session);
  const pageB = await ctxB.newPage();
  // New device lands on /link (post-OAuth redirect target when sync is on).
  await pageB.goto('/link');
  // detect() → remote-only → password prompt; same master password as A.
  await pageB.getByLabel('Master password').fill(MASTER_PASSWORD);
  await pageB.getByRole('button', { name: /unlock & link device|desbloquear y vincular/i }).click();
  await pageB.waitForURL('**/dashboard', { timeout: 20_000 });
  // B sees A's subscription — pulled, decrypted client-side, hydrated.
  await gotoSubscriptions(pageB);
  await expect(pageB.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 10_000 });

  // ── B edits → push ──────────────────────────────────────────────────────────
  await addSubscriptionOn(pageB, SERVICE_B);
  await flushPush(pageB);
  await waitForRemoteVersion(url, anonKey, session.access_token, versionAfterA + 1);

  // ── A converges: reload → unlock → reconcileNow pulls remote ───────────────
  await pageA.reload();
  await pageA.waitForURL('**/unlock', { timeout: 15_000 });
  await pageA.getByLabel('Master password').fill(MASTER_PASSWORD);
  await pageA.getByRole('button', { name: /unlock vault/i }).click();
  await pageA.waitForURL('**/dashboard', { timeout: 20_000 });
  await gotoSubscriptions(pageA);
  // A sees BOTH subscriptions: its own and B's.
  await expect(pageA.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByRole('button', { name: new RegExp(SERVICE_B, 'i') })).toBeVisible({ timeout: 15_000 });

  // ── Cleanup: drop the remote row (RLS allows deleting own row) ─────────────
  await fetch(`${url}/rest/v1/vaults?user_id=eq.${session.user.id}`, {
    method: 'DELETE',
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
  });

  await ctxA.close();
  await ctxB.close();
});
