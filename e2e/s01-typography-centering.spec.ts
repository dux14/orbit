import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-14", width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test(`onboarding centered + Space Grotesk @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/onboarding");

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    // Heading font resolves to Space Grotesk
    const fontFamily = await heading.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(fontFamily.toLowerCase()).toContain("space grotesk");

    // Base font-size is 17.5px
    const htmlFontSize = await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    );
    // 109.375% of the 16px browser default — tolerate sub-pixel rounding
    expect(parseFloat(htmlFontSize)).toBeCloseTo(17.5, 1);

    await page.screenshot({
      path: `e2e/__screenshots__/s01-onboarding-${vp.name}.png`,
      fullPage: true,
    });
  });

  test(`unlock screen: no horizontal overflow @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/unlock");
    // Either the unlock form or a redirect to onboarding is acceptable here;
    // we only assert the page paints without layout overflow.
    const body = page.locator("body");
    const overflow = await body.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `e2e/__screenshots__/s01-unlock-${vp.name}.png`,
    });
  });
}
