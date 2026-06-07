// e2e/helpers/multi-device.ts
/**
 * Shared helpers for the encrypted-sync E2E suites (multi-device, sync flow).
 *
 * Auth model (S8 — see docs/manual-checklists/s12-e2e.md):
 *   Each run signs up a unique throwaway user via the Supabase REST API
 *   (anon key, requires mailer_autoconfirm) and injects the session as the
 *   @supabase/ssr auth cookie — no Google OAuth, no static TEST_SUPABASE_SESSION.
 *   Real RLS, real upsert_vault, real ciphertext.
 *
 * Device model: one Playwright BrowserContext = one device (isolated
 * IndexedDB / localStorage / cookies), all sharing the same Supabase account.
 */

import { expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MASTER_PASSWORD = 'TestPassword1!';

export const syncEnabled = process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true';

// ── Env: Supabase URL + anon key (process.env first, .env.local fallback —
//    the Playwright runner does not load Next's dotenv files) ────────────────
export function loadSupabaseEnv(): { url: string; anonKey: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) {
    try {
      const envFile = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
      for (const line of envFile.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m?.[1] === 'NEXT_PUBLIC_SUPABASE_URL' && !url) url = m[2].trim();
        if (m?.[1] === 'NEXT_PUBLIC_SUPABASE_ANON_KEY' && !anonKey) anonKey = m[2].trim();
      }
    } catch {
      // leave empty — callers assert and produce a clear failure message
    }
  }
  return { url, anonKey };
}

export interface TestSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  user: { id: string };
}

/** Creates a unique throwaway user via REST signup (requires autoconfirm). */
export async function signUpTestUser(url: string, anonKey: string, tag: string): Promise<TestSession> {
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
export async function injectSession(ctx: BrowserContext, supabaseUrl: string, session: TestSession) {
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
export async function waitForRemoteVersion(
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

/** Deletes the throwaway user's remote vault row (RLS allows deleting own row). */
export async function deleteRemoteVault(url: string, anonKey: string, session: TestSession) {
  await fetch(`${url}/rest/v1/vaults?user_id=eq.${session.user.id}`, {
    method: 'DELETE',
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
  });
}

// ── UI helpers (selectors mirror e2e/orbit.spec.ts) ─────────────────────────
export async function createVaultOn(page: Page) {
  await page.goto('/');
  await page.waitForURL('**/onboarding', { timeout: 15_000 });
  await page.getByLabel('Master password').first().fill(MASTER_PASSWORD);
  await page.getByLabel('Confirm password').fill(MASTER_PASSWORD);
  await page.getByRole('button', { name: /create vault/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

/** New device: lands on /link, enters the shared master password, reaches dashboard. */
export async function linkDeviceOn(page: Page) {
  await page.goto('/link');
  await page.getByLabel('Master password').fill(MASTER_PASSWORD);
  await page.getByRole('button', { name: /unlock & link device|desbloquear y vincular/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

export async function gotoSubscriptions(page: Page) {
  // Skip navigation when already there: clicking a Next.js link fires an RSC
  // fetch, which fails while the context is OFFLINE and triggers a hard reload
  // (locking the vault — the key lives only in memory). NOTE: the guard is
  // purely path-based — callers must not rely on this helper to force a fresh
  // load or re-hydration of an already-open /subscriptions page.
  if (new URL(page.url()).pathname === '/subscriptions') return;
  await page.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/subscriptions', { timeout: 10_000 });
}

export async function gotoSettings(page: Page) {
  await page.getByRole('link', { name: /^settings$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/settings', { timeout: 10_000 });
}

export async function addSubscriptionOn(page: Page, name: string) {
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
export async function flushPush(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
}

/**
 * Force a reconcile pull: the sync lifecycle listens for window `online`
 * (and `visibilitychange`) → maybeReconcileNow(). Dispatching `online`
 * matches what the browser fires after context.setOffline(false).
 */
export async function triggerReconcile(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
