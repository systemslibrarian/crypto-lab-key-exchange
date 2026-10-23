import { expect, test } from '@playwright/test';

test('numeric comparison displays the honest, adaptive, and committed outcomes', async ({ page }) => {
  await page.goto('.');

  await page.getByRole('button', { name: 'Honest exchange' }).click();
  await expect(page.locator('#pairing-verdict')).toContainText('Honest exchange');
  const honestAlice = await page.locator('#pairing-alice-code').innerText();
  await expect(page.locator('#pairing-bob-code')).toHaveText(honestAlice);
  await expect(page.locator('#pairing-commitment')).toHaveText('yes');
  await expect(page.locator('#pairing-proceeds')).toHaveText('yes in this model');

  await page.getByRole('button', { name: 'Eve chooses late' }).click();
  await expect(page.locator('#pairing-verdict')).toContainText('Same short code, two different');
  const attackAlice = await page.locator('#pairing-alice-code').innerText();
  await expect(page.locator('#pairing-bob-code')).toHaveText(attackAlice);
  await expect(page.locator('#pairing-initial-code')).not.toHaveText(attackAlice);
  await expect(page.locator('#pairing-commitment')).toHaveText('not checked');
  await expect(page.locator('#pairing-output')).toContainText('Eve has two legs');

  await page.getByRole('button', { name: 'Same attempt, commit first' }).click();
  await expect(page.locator('#pairing-alice-code')).toHaveText(attackAlice);
  await expect(page.locator('#pairing-bob-code')).toHaveText(attackAlice);
  await expect(page.locator('#pairing-commitment')).toHaveText('no — changed nonce');
  await expect(page.locator('#pairing-proceeds')).toHaveText('no — abort');
  await expect(page.locator('#pairing-output')).toContainText('would-be code (never displayed)');
  await expect(page.locator('#pairing-output')).toContainText('Committed SHA-256:');

  const source = page.getByRole('link', { name: /Bluetooth Core Specification v6.3/ });
  await expect(source).toHaveAttribute('href', /bluetooth\.com.*security-manager-specification\.html/);
});
