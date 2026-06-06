import { test, expect } from "@playwright/test";

test("manifest serves plum theme_color and valid icons", async ({ request }) => {
  const res = await request.get("/manifest.json");
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.theme_color).toBe("#090b17");
  expect(manifest.background_color).toBe("#f8f6fe");
  const purposes = manifest.icons.map((i: { src: string }) => i.src);
  expect(purposes).toContain("/icons/icon-192.png");
  expect(purposes).toContain("/icons/icon-512.png");
  expect(purposes).toContain("/icons/maskable-512.png");

  // Each referenced icon actually resolves.
  for (const src of purposes) {
    const iconRes = await request.get(src);
    expect(iconRes.ok(), `${src} should resolve`).toBeTruthy();
  }
});

test("aurora OrbitLogo renders and screenshot captured", async ({ page }) => {
  await page.goto("/onboarding");
  const logo = page.getByRole("img", { name: "Orbit logo" }).first();
  await expect(logo).toBeVisible();
  await logo.screenshot({ path: "e2e/__screenshots__/s03-orbit-logo.png" });
});
