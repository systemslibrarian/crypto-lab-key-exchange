import { expect, test, type Page } from '@playwright/test';

/**
 * Browser gate for the MitM relay exhibit.
 *
 * Every assertion below is on something the page COMPUTED in that run — the
 * plaintext Eve's AES-GCM key actually recovered, the plaintext Bob actually
 * decrypted, the real Ed25519 verification outcome — not on static copy. The
 * authenticated variant must be shown to defeat the same attack, or the panel
 * is back to displaying secrets and asserting a moral.
 */

const ALICE_MESSAGE = 'Attack at dawn. Bring the ledger. — Alice';

async function boot(page: Page): Promise<void> {
  await page.goto('.');
  await expect(page.locator('#mitm-msg')).toBeVisible();
  await page.locator('#mitm-msg').fill(ALICE_MESSAGE);
}

test('unauthenticated: Eve decrypts the real ciphertext and Bob still reads it', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#mitm-relay').click();

  await expect(page.locator('#mitm-verdict')).toContainText('Eve read the message');
  await expect(page.locator('#mitm-eve-read')).toHaveText(ALICE_MESSAGE);
  await expect(page.locator('#mitm-bob-read')).toHaveText(ALICE_MESSAGE);

  // Bob cannot open the ciphertext Alice actually produced: a real tag failure.
  await expect(page.locator('#mitm-relay-output')).toContainText('real AES-GCM tag failure');
  // The check Alice skipped is computed anyway and would have failed.
  await expect(page.locator('#mitm-relay-output')).toContainText('accepted on sight');
  await expect(page.locator('#mitm-relay-output')).toContainText('INVALID');
  await expect(page.locator('#mitm-relay-output')).toContainText(
    'Control: same check over Bob’s genuine share',
  );
});

test('unauthenticated: Eve can replace the message and Bob’s decryption still succeeds', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#mitm-tamper').check();
  await page.locator('#mitm-relay').click();

  await expect(page.locator('#mitm-eve-read')).toHaveText(ALICE_MESSAGE);
  const bobRead = (await page.locator('#mitm-bob-read').innerText()).trim();
  expect(bobRead).not.toBe(ALICE_MESSAGE);
  expect(bobRead).toContain('account 4471');
});

test('authenticated: signed key shares defeat the identical attack', async ({ page }) => {
  await boot(page);
  await page.locator('#mitm-tamper').check();
  await page.locator('#mitm-authrun').click();

  await expect(page.locator('#mitm-verdict')).toContainText('Attack defeated');
  await expect(page.locator('#mitm-eve-read')).toHaveText('nothing');
  await expect(page.locator('#mitm-bob-read')).toHaveText('nothing');
  await expect(page.locator('#mitm-relay-output')).toContainText('signed key shares');
  await expect(page.locator('#mitm-relay-output')).toContainText('returned false');
});

test('both variants run back to back from the same substitution', async ({ page }) => {
  await boot(page);
  await page.locator('#mitm-relay').click();
  await expect(page.locator('#mitm-verdict')).toContainText('Eve read the message');
  await expect(page.locator('#mitm-relay-output')).toContainText('Eve’s, not Bob’s');

  await page.locator('#mitm-authrun').click();
  await expect(page.locator('#mitm-verdict')).toContainText('Attack defeated');
  await expect(page.locator('#mitm-relay-output')).toContainText('Eve’s, not Bob’s');
});

test('changing an exchange parameter clears a stale relay result', async ({ page }) => {
  await boot(page);
  await page.locator('#mitm-relay').click();
  await expect(page.locator('#mitm-verdict')).toBeVisible();

  await page.locator('#mitm-a').fill('7');
  await expect(page.locator('#mitm-verdict')).toHaveCount(0);
});
