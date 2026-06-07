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
