// Headless smoke test — desktop + mobile viewports, real interactions.
// Run after `npm run preview` is serving on http://localhost:4173.
import { chromium, devices } from 'playwright';

const URL = 'http://localhost:4173/crypto-lab-key-exchange/';

function assert(cond, msg) {
	if (!cond) {
		console.error('FAIL:', msg);
		process.exitCode = 1;
	} else {
		console.log('ok  :', msg);
	}
}

async function run(label, deviceOpts) {
	console.log(`\n=== ${label} ===`);
	const browser = await chromium.launch();
	const ctx = await browser.newContext(deviceOpts ?? {});
	const page = await ctx.newPage();

	const errors = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});

	await page.goto(URL, { waitUntil: 'networkidle' });

	const h1 = await page.locator('h1').first().textContent();
	assert(h1?.trim() === 'Key Exchange', `h1 reads "Key Exchange" (got "${h1}")`);

	const skip = await page.locator('a.skip-link').first().textContent();
	assert(skip?.trim() === 'Skip to content', 'skip link present');

	const themeBtn = page.locator('#theme-toggle');
	await themeBtn.waitFor();
	const initLabel = await themeBtn.getAttribute('aria-label');
	await themeBtn.click();
	const afterLabel = await themeBtn.getAttribute('aria-label');
	assert(initLabel !== afterLabel, `theme toggle flips aria-label (${initLabel} → ${afterLabel})`);
	const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
	assert(theme === 'light' || theme === 'dark', `data-theme set (${theme})`);
	await themeBtn.click(); // restore

	const tabs = page.locator('[role="tab"]');
	const tabCount = await tabs.count();
	assert(tabCount === 5, `5 generation tabs (got ${tabCount})`);

	// Keyboard nav on tablist
	await tabs.first().focus();
	await page.keyboard.press('ArrowRight');
	const activeAfterArrow = await page.evaluate(() => document.activeElement?.getAttribute('data-id'));
	assert(activeAfterArrow === 'ecdh', `ArrowRight moves focus to ecdh (got ${activeAfterArrow})`);
	await page.keyboard.press('End');
	const activeAfterEnd = await page.evaluate(() => document.activeElement?.getAttribute('data-id'));
	assert(activeAfterEnd === 'hybrid', `End moves focus to last tab (got ${activeAfterEnd})`);
	await page.keyboard.press('Home');
	const activeAfterHome = await page.evaluate(() => document.activeElement?.getAttribute('data-id'));
	assert(activeAfterHome === 'dh', `Home moves focus to first tab (got ${activeAfterHome})`);

	// DH playground recomputes
	const dhA = page.locator('#dh-a');
	await dhA.fill('7');
	await page.waitForTimeout(50);
	const dhOutput = await page.locator('#dh-output').textContent();
	assert(/Both sides agree/.test(dhOutput ?? ''), 'DH agree status visible');

	// Break-it actually recovers an exponent
	await page.click('#dh-attack');
	await page.waitForTimeout(50);
	const attackOut = await page.locator('#dh-attack-output').textContent();
	assert(/Recovered Alice/.test(attackOut ?? ''), 'discrete-log attack recovers exponent');

	// ECDH playground
	const ecOut = await page.locator('#ec-output').textContent();
	assert(/a·B = b·A/.test(ecOut ?? ''), 'ECDH agreement visible');

	// KEM auto-runs on mount; wait for it
	await page.waitForFunction(() => /agree:/.test(document.querySelector('#kem-output')?.textContent ?? ''));
	assert(true, 'KEM result populated');

	// Hybrid combine — click and wait for session line
	await page.click('#hybrid-run');
	await page.waitForFunction(() => /SHA-256/.test(document.querySelector('#hybrid-output')?.textContent ?? ''));
	assert(true, 'hybrid combine renders session key');

	// Scripture footer is last visible element
	const lastText = await page.evaluate(() => {
		const all = document.querySelectorAll('p');
		return all[all.length - 1]?.textContent?.trim() ?? '';
	});
	assert(/glory of God/.test(lastText), 'scripture footer is last paragraph');

	// Mobile-only: theme toggle still tappable, no horizontal overflow
	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
	assert(scrollWidth <= clientWidth + 1, `no horizontal overflow (sw=${scrollWidth} cw=${clientWidth})`);

	if (errors.length) {
		console.error('CONSOLE / PAGE ERRORS:');
		errors.forEach((e) => console.error('  ' + e));
		process.exitCode = 1;
	} else {
		console.log('ok  : no console errors');
	}

	await browser.close();
}

await run('desktop 1280x800', { viewport: { width: 1280, height: 800 } });
await run('mobile iPhone 12', devices['iPhone 12']);
await run('narrow 360x740', { viewport: { width: 360, height: 740 } });

if (process.exitCode) {
	console.error('\nSMOKE: FAIL');
} else {
	console.log('\nSMOKE: PASS');
}
