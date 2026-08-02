import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Scans the full page with every collapsible expanded,
 * in both the dark (default) and light themes. Modeled on the ascon lab gate.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function revealAll(page: Page): Promise<void> {
  // Neutralize animations/transitions/opacity so nothing is mid-fade when axe
  // measures contrast.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation: none !important;
      transition: none !important;
      opacity: 1 !important;
    }`,
  });
  // Open every <details>, reveal [hidden] panels/modals (e.g. the keyboard
  // shortcuts dialog), and un-hide anything inline-hidden.
  await page.evaluate(() => {
    for (const details of Array.from(document.querySelectorAll('details'))) {
      (details as HTMLDetailsElement).open = true;
    }
    for (const el of Array.from(document.querySelectorAll('[hidden]'))) {
      el.removeAttribute('hidden');
    }
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        '[style*="display: none"], [style*="display:none"]',
      ),
    )) {
      el.style.display = '';
    }
  });
}

// The MitM relay renders only after it runs, and its two outcomes (relayed
// attack vs. signature-aborted) are different markup. Drive both so the scan
// covers what a learner actually sees.
async function runRelay(page: Page, authenticated: boolean): Promise<void> {
  await page.locator('#mitm-tamper').check();
  await page.locator(authenticated ? '#mitm-authrun' : '#mitm-relay').click();
  await expect(page.locator('#mitm-verdict')).toBeVisible();
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

// revealAll() un-hides the keyboard-shortcuts dialog, which then covers the
// page, so each relay outcome gets a fresh load: run the relay, reveal, scan.
async function loadRunAndScan(
  page: Page,
  light: boolean,
  relay: 'none' | 'attack' | 'defended',
): Promise<void> {
  await page.goto('.');
  // The topbar toggle persists the choice in localStorage, so a second load in
  // the same test may already be in the target theme — toggle only if needed.
  const want = light ? 'light' : 'dark';
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== want) await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', want);
  if (relay !== 'none') await runRelay(page, relay === 'defended');
  await revealAll(page);
  await scan(page);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await loadRunAndScan(page, false, 'none');
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await loadRunAndScan(page, true, 'none');
});

test('no WCAG A/AA violations with the MitM relay run (dark)', async ({ page }) => {
  await loadRunAndScan(page, false, 'attack');
  await loadRunAndScan(page, false, 'defended');
});

test('no WCAG A/AA violations with the MitM relay run (light)', async ({ page }) => {
  await loadRunAndScan(page, true, 'attack');
  await loadRunAndScan(page, true, 'defended');
});
