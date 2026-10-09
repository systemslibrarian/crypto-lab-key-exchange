import { expect, test } from '@playwright/test';

for (const width of [1280, 390, 360]) {
  for (const theme of ['dark', 'light']) {
    test(`brand accessible name includes its visible text at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await page.goto('.');
      const brand = page.locator('.cl-brand');
      await expect(brand).toBeVisible();
      await expect(brand.locator('.cl-title')).toHaveText('CRYPTO LAB');
      await expect(brand.locator('.cl-sub')).toHaveText('systemslibrarian.dev');
      if (width === 1280) {
        await expect(brand.locator('.cl-sub')).toBeVisible();
        await expect(brand).toHaveAccessibleName(/^CL CRYPTO LAB systemslibrarian\.dev$/);
      } else {
        await expect(brand.locator('.cl-sub')).toBeHidden();
        await expect(brand).toHaveAccessibleName(/^CL CRYPTO LAB$/);
      }
      await expect(brand).toHaveAttribute('href', 'https://crypto-lab.systemslibrarian.dev/');
    });
  }
}
