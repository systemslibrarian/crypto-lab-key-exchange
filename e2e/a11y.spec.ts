import { test } from '@playwright/test';
import { boot, driveAllStates, expectBaselineNotStale, NARROW } from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * Every exhibit's computed output is scanned in both themes at desktop and
 * phone width. See `gate.ts` for why nothing is injected into the page, why
 * each scan asserts its content first, and why `violations` is not the whole
 * oracle.
 *
 * `expectBaselineNotStale` is the non-text baseline's third rule — a listed
 * finding that no longer appears fails, so a fixed entry must be deleted and
 * the file can only shrink. It runs in the DARK configurations only, and that
 * restriction is measured rather than stylistic. `nonTextSeen` is module state
 * and `fullyParallel` gives every configuration its own worker, so each
 * ratchets against what it alone drove. Run in isolation, each dark
 * configuration reaches all seventeen baselined selectors; each light one
 * reaches fifteen, because `#gen-tab-dh.gen-pill.is-active` and `.copy-chip`
 * clear 3:1 against the light surface and fail against the dark one. Light's
 * set is a strict subset, so running the rule in dark loses no coverage, while
 * running it in light reported those two as stale on every run.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(600_000);
    await boot(page, theme);
    await driveAllStates(page, theme);
    if (theme === 'dark') expectBaselineNotStale();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    if (theme === 'dark') expectBaselineNotStale();
  });
}
