/**
 * Orbit e2e tests — Playwright
 *
 * Flows:
 *   1. create vault → add subscription → lock (reload) → unlock → see data
 *   2. export then import restores after wipe
 *   3. dark/light toggle persists across reload
 *
 * Each test creates its own vault in a fresh browser context
 * (Playwright isolates IndexedDB / localStorage per test by default).
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';

// ── Helpers ────────────────────────────────────────────────────────────────────

const MASTER_PASSWORD = 'TestPassword1!';
const SERVICE_NAME = 'Netflix';
const SERVICE_AMOUNT = '15.99';
const RENEWAL_DATE = '2026-12-31';

/** Navigate to / and wait until we land on /onboarding (fresh context = no vault). */
async function goToOnboarding(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForURL('**/onboarding', { timeout: 15_000 });
}

/** Complete the onboarding form and end up on /dashboard. */
async function createVault(page: import('@playwright/test').Page, password = MASTER_PASSWORD) {
  await goToOnboarding(page);

  await page.getByLabel('Master password').first().fill(password);
  await page.getByLabel('Confirm password').fill(password);

  // Button text: "Create vault"
  await page.getByRole('button', { name: /create vault/i }).click();

  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

/**
 * Navigate to /subscriptions via client-side nav link (avoids hard reload that
 * would wipe in-memory vault key and trigger VaultGuard redirect).
 * Uses force:true to bypass the Next.js dev overlay that intercepts pointer events.
 */
async function gotoSubscriptions(page: import('@playwright/test').Page) {
  // Both the desktop sidebar and the mobile bottom-tab nav are always in the DOM
  // (toggled by CSS `hidden md:flex` / `flex md:hidden`), so the same nav link exists
  // twice. `filter({ visible: true })` picks the one rendered for the current viewport;
  // the `^subscriptions$` name excludes the dashboard "Add a subscription" quick link.
  // A normal (non-forced) click waits for actionability — covering the brief `inert`
  // window while a just-closed dialog finishes animating out.
  await page.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/subscriptions', { timeout: 10_000 });
}

/** Navigate to /subscriptions and add one subscription. */
async function addSubscription(
  page: import('@playwright/test').Page,
  name = SERVICE_NAME,
  amount = SERVICE_AMOUNT,
  renewalDate = RENEWAL_DATE,
) {
  await gotoSubscriptions(page);

  // On mobile the FAB has aria-label "Add subscription"; on desktop the header "Add" button is hidden (md:inline-flex)
  // Use the FAB which is always present (even if hidden on desktop via CSS, we can click it)
  // More robust: use the first clickable add trigger
  const addBtn = page.getByRole('button', { name: /add subscription/i }).or(
    page.getByRole('button', { name: /^add$/i }),
  );
  await addBtn.first().click();

  // Sheet should open — fill the form
  await page.getByLabel('Service name').fill(name);
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Next renewal').fill(renewalDate);

  await page.getByRole('button', { name: /^save$/i }).click();

  // Sheet closes, subscription appears in list
  await expect(page.getByRole('button', { name: new RegExp(name, 'i') })).toBeVisible({ timeout: 10_000 });
}

/** Unlock from the /unlock page. */
async function unlockVault(page: import('@playwright/test').Page, password = MASTER_PASSWORD) {
  await page.waitForURL('**/unlock', { timeout: 15_000 });
  await page.getByLabel('Master password').fill(password);
  await page.getByRole('button', { name: /unlock vault/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

/** Navigate to Settings via client-side nav link (avoids hard reload / vault lock). */
async function goToSettings(page: import('@playwright/test').Page) {
  // See gotoSubscriptions: pick the viewport-visible nav link, normal click (waits for
  // the dialog-close `inert` window to clear).
  await page.getByRole('link', { name: /^settings$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/settings', { timeout: 10_000 });
}

// ── Test 1: create vault → add subscription → lock (reload) → unlock → see data ──

test('create vault, add subscription, reload locks, unlock shows data', async ({ page }) => {
  await createVault(page);
  await addSubscription(page);

  // Reload simulates locking (memory wiped)
  await page.reload();

  // Should redirect to /unlock
  await unlockVault(page);

  // Navigate to subscriptions via client-side nav and verify data is there
  await gotoSubscriptions(page);

  await expect(
    page.getByRole('button', { name: new RegExp(SERVICE_NAME, 'i') }),
  ).toBeVisible({ timeout: 10_000 });
});

// ── Test 2: export then import restores after wipe ────────────────────────────

test('export backup, wipe vault, import restores subscription', async ({ page }) => {
  await createVault(page);
  await addSubscription(page);

  // Go to Settings and export
  await goToSettings(page);

  // Wait for the export button and click it, capturing the download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /download backup/i }).click(),
  ]);

  // Save to a temp path we can read back
  const tmpDir = os.tmpdir();
  const backupPath = path.join(tmpDir, `orbit-backup-${Date.now()}.orbit`);
  await download.saveAs(backupPath);

  // Wipe vault: click "Wipe everything", confirm in dialog
  await page.getByRole('button', { name: /wipe everything/i }).click();

  // Confirm dialog — click destructive "Yes, wipe everything" button
  await page.getByRole('button', { name: /yes, wipe everything/i }).click();

  // Should land on /onboarding (fresh DB)
  await page.waitForURL('**/onboarding', { timeout: 15_000 });

  // Import: create vault first is NOT needed — import replaces the DB
  // Navigate to settings requires vault, so instead we need to go through onboarding
  // Actually import is on the settings page which requires a vault to be unlocked.
  // The flow is: onboarding → create a new vault → go to settings → import.
  // But that would overwrite the restored data.
  // The correct flow: use the import on the settings page which wipes+restores.
  // So: create a NEW temporary vault first, then import the backup.
  const TEMP_PASSWORD = 'TempPassword1!';
  await page.getByLabel('Master password').first().fill(TEMP_PASSWORD);
  await page.getByLabel('Confirm password').fill(TEMP_PASSWORD);
  await page.getByRole('button', { name: /create vault/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  // Now go to settings and import the backup
  await goToSettings(page);

  // The import button triggers a file chooser dialog
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /choose \.orbit file/i }).click(),
  ]);
  await fileChooser.setFiles(backupPath);

  // Password dialog appears — enter the ORIGINAL password (the backup's password).
  // Use the textbox role: the dialog title "Enter master password" also matches
  // getByLabel('Master password'), so the role filter disambiguates to the input.
  await page.getByRole('textbox', { name: 'Master password' }).fill(MASTER_PASSWORD);
  await page.getByRole('button', { name: /restore backup/i }).click();

  // After import the vault is locked and we're sent to /unlock
  await unlockVault(page, MASTER_PASSWORD);

  // Navigate to subscriptions via client-side nav and verify data was restored
  await gotoSubscriptions(page);

  await expect(
    page.getByRole('button', { name: new RegExp(SERVICE_NAME, 'i') }),
  ).toBeVisible({ timeout: 10_000 });
});

// ── Test 3: dark/light toggle persists across reload ─────────────────────────

test('theme toggle: dark mode persists across reload', async ({ page }) => {
  await createVault(page);

  // Ensure we start in light mode: set localStorage directly
  await page.evaluate(() => {
    localStorage.setItem('orbit-theme', 'light');
  });
  await page.reload();
  // Re-unlock after reload
  await unlockVault(page);

  // Verify light mode: html should NOT have .dark class
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  // Find the ThemeToggle button and cycle it to dark (light → dark)
  // The button label is "Current theme: Light theme. Click to cycle theme."
  const themeToggle = page.getByRole('button', { name: /click to cycle theme/i }).first();
  await themeToggle.click();

  // html should now have .dark class
  await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 5_000 });

  // Verify persisted to localStorage
  const storedTheme = await page.evaluate(() => localStorage.getItem('orbit-theme'));
  expect(storedTheme).toBe('dark');

  // Reload (will lock vault) and re-unlock
  await page.reload();
  await unlockVault(page);

  // .dark class should still be present (persisted theme)
  await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 5_000 });
});

// ── Test 4: add subscription with a NEW card → card appears in Payment Methods ──

async function gotoCards(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: /^(cards|tarjetas)$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/payment-methods', { timeout: 10_000 });
}

test('create subscription with a new inline card, then see it in Payment Methods', async ({ page }) => {
  await createVault(page);
  await gotoSubscriptions(page);

  const addBtn = page.getByRole('button', { name: /add subscription/i }).or(
    page.getByRole('button', { name: /^add$/i }),
  );
  await addBtn.first().click();

  // Essential block
  await page.getByLabel('Service name').fill('Spotify');
  await page.getByLabel('Amount').fill('9.99');
  await page.getByLabel('Next renewal').fill('2026-12-31');

  // Card picker: open the inline new-card form
  await page.getByRole('radio', { name: /new card/i }).click();
  await page.getByLabel(/alias/i).fill('Gift Visa');
  await page.getByLabel(/last 4 digits/i).fill('4242');

  await page.getByRole('button', { name: /^save$/i }).click();

  // Subscription appears
  await expect(page.getByRole('button', { name: /spotify/i })).toBeVisible({ timeout: 10_000 });

  // The new card now lives in Payment Methods (same encrypted store)
  await gotoCards(page);
  await expect(page.getByText(/gift visa/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/4242/)).toBeVisible();
});
