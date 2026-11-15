// Headless smoke test — desktop + mobile viewports, real interactions.
// Run after `npm run preview` is serving on http://localhost:4674.
import { chromium, devices } from '@playwright/test';

const URL = 'http://localhost:4674/crypto-lab-key-exchange/';

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

	// Dark is the only theme: the page pins it before first paint and the shared
	// header carries no toggle, so there is nothing to flip.
	const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
	assert(theme === 'dark', `page is pinned to the dark theme (${theme})`);
	assert((await page.locator('#cl-theme-toggle').count()) === 0, 'no theme toggle in the shared header');

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

	// Merkle-puzzle prequel: use the number inputs (keyboard fallbacks), run the
	// honest exchange, the transcript-only break, the broken textbook form, and
	// cancellation of a larger run.
	await page.locator('#puzzle-b-number').fill('8');
	await page.locator('#puzzle-l-number').fill('256');
	await page.locator('#puzzle-build').click();
	await page.waitForFunction(() => /table matches 0 puzzles/.test(document.querySelector('#puzzle-table-verdict')?.textContent ?? ''));
	assert(true, 'independent Merkle puzzles defeat the shared-prefix table');
	await page.locator('#puzzle-bob').click();
	await page.waitForFunction(() => /Alice and Bob hold the same/.test(document.querySelector('#puzzle-agreement')?.textContent ?? ''));
	assert(true, 'Merkle Alice and Bob agree byte for byte');
	await page.locator('#puzzle-eve').click();
	await page.waitForFunction(() => /RECOVERED BY THE EAVESDROPPER/.test(document.querySelector('#puzzle-eve-verdict')?.textContent ?? ''));
	assert(true, 'Merkle Eve recovers from transcript-only work');
	await page.locator('#puzzle-corrupt-bob').click();
	const corruptedAgreement = await page.locator('#puzzle-agreement-headline').textContent();
	assert(/NOT AGREED/.test(corruptedAgreement ?? ''), 'one changed Bob byte retires the agreement');

	await page.locator('#puzzle-textbook').check();
	await page.locator('#puzzle-build').click();
	const brokenTable = await page.locator('#puzzle-table-verdict').textContent();
	assert(/BROKEN — one table/.test(brokenTable ?? ''), 'textbook form is visibly broken by one table');
	await page.locator('#puzzle-textbook').uncheck();
	await page.locator('#puzzle-build').click();

	await page.locator('#puzzle-b-number').fill('14');
	await page.locator('#puzzle-l-number').fill('4096');
	await page.locator('#puzzle-build').click();
	await page.locator('#puzzle-bob').click();
	await page.locator('#puzzle-eve').click();
	await page.locator('#puzzle-cancel').click();
	const cancelledEve = await page.locator('#puzzle-eve-verdict').textContent();
	assert(/cancelled/.test(cancelledEve ?? ''), 'Merkle Eve run can be cancelled');

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
	await page.waitForFunction(() => /HKDF/.test(document.querySelector('#hybrid-output')?.textContent ?? ''));
	assert(true, 'hybrid combine renders session key');

	// MitM section
	const mitmParties = await page.locator('.mitm-party').count();
	assert(mitmParties === 3, `MitM has 3 parties (got ${mitmParties})`);
	const mitmOut = await page.locator('#mitm-output').textContent();
	assert(/Different secrets/.test(mitmOut ?? ''), 'MitM shows Alice and Bob have different secrets');

	// Shor section — default N=15 + a=2 should factor cleanly
	const shorOut = await page.locator('#shor-output').textContent();
	assert(/15 = 3 × 5/.test(shorOut ?? ''), 'Shor classical factors 15 = 3 × 5');
	const shorCycleSteps = await page.locator('.shor-cycle-step').count();
	assert(shorCycleSteps >= 4, `Shor shows full cycle (got ${shorCycleSteps} steps)`);

	// Module-LWE section
	const mlweMatrices = await page.locator('.mlwe-matrix').count();
	assert(mlweMatrices === 4, `Module-LWE shows A, s, e, b (got ${mlweMatrices})`);

	// Hybrid security argument is reachable in the hybrid section
	const hybridSec = await page.locator('.hybrid-security').count();
	assert(hybridSec === 1, `hybrid security details present (got ${hybridSec})`);

	// Discrete-log scaling table
	await page.click('#dh-attack');
	const scaleRows = await page.locator('.scale-row').count();
	assert(scaleRows === 5, `scaling table has 5 tiers (got ${scaleRows})`);

	// Curve25519 contrast
	const contrastRows = await page.locator('.curve-contrast tbody tr').count();
	assert(contrastRows === 7, `Curve25519 contrast has 7 rows (got ${contrastRows})`);

	// Decision card + synthesis + compare table + trust signals
	const decisionRows = await page.locator('.decision-row').count();
	assert(decisionRows === 4, `decision card has 4 rows (got ${decisionRows})`);
	const synthesisItems = await page.locator('.synthesis-list li').count();
	assert(synthesisItems === 3, `synthesis has 3 items (got ${synthesisItems})`);
	const compareCols = await page.locator('.compare-table thead th').count();
	assert(compareCols === 6, `compare table has 6 columns (got ${compareCols})`);
	const threatStrips = await page.locator('.threat-strip').count();
	assert(threatStrips >= 4, `threat-model chips on interactive sections (got ${threatStrips})`);
	const toyBanners = await page.locator('.toy-banner').count();
	assert(toyBanners >= 2, `toy-parameter warning banners present (got ${toyBanners})`);

	const navLinks = await page.locator('.section-nav-link').count();
	assert(navLinks === 16, `section nav has 16 links (got ${navLinks})`);
	const sizeRows = await page.locator('.size-row').count();
	assert(sizeRows === 5, `sizes section has 5 rows (got ${sizeRows})`);
	const histItems = await page.locator('.hist-item').count();
	assert(histItems === 10, `history timeline has 10 items (got ${histItems})`);
	const deployments = await page.locator('#production .panel-card').count();
	assert(deployments === 5, `production section has 5 deployments (got ${deployments})`);
	const refs = await page.locator('.ref-row').count();
	assert(refs === 9, `references has 9 entries (got ${refs})`);
	const glossary = await page.locator('.glossary-row').count();
	assert(glossary === 8, `glossary has 8 entries (got ${glossary})`);
	const curveDots = await page.locator('.ec-svg-dot').count();
	assert(curveDots === 18, `EC curve plot has 18 finite points (got ${curveDots})`);
	const highlighted = await page.locator('.ec-svg-dot.ec-dot--g, .ec-svg-dot.ec-dot--a, .ec-svg-dot.ec-dot--b, .ec-svg-dot.ec-dot--shared').count();
	assert(highlighted >= 3, `curve plot highlights G/A/B/shared (got ${highlighted})`);

	// ---- Corrected figures, 15 November 2026 --------------------------------
	// Each assertion below pins a number or attribution that a primary source
	// fixed, so restoring the old text fails the smoke run instead of shipping.
	const expOps = (bits) => (2 ** bits).toExponential(1);
	const scaleText = (await page.locator('.scale-table').textContent()) ?? '';
	assert(/\u2264 80-bit strength; no longer approved/.test(scaleText), '1024-bit DH row carries NIST\u2019s \u2264 80-bit strength, not "broken"');
	assert(/112-bit strength; production/.test(scaleText), '2048-bit DH row carries NIST\u2019s 112-bit strength');
	assert(scaleText.includes(expOps(80)), `1024-bit DH row shows 2^80 operations (${expOps(80)})`);
	assert(scaleText.includes(expOps(112)), `2048-bit DH row shows 2^112 operations (${expOps(112)})`);
	assert(!scaleText.includes(expOps(110)) && !scaleText.includes(expOps(160)), 'the old 2^110 / 2^160 operation counts are gone');
	// The consequence has to follow the corrected figure: 2^80 at 10^9 ops/s is
	// tens of millions of years, not a fraction of a universe age.
	assert(/3\.8e\+7 years/.test(scaleText), '\u2264 80-bit row reads in years, not as a fraction of a universe age');
	assert(/1\.2e\+7 \u00d7 age of universe/.test(scaleText), '2048-bit row still reads as millions of universe ages');

	const shorTable = (await page.locator('.shor-resources').textContent()) ?? '';
	assert(/\u2248 6 190/.test(shorTable), 'Gidney \u0026 Eker\u00e5 logical qubits are \u2248 6 190 (3n + 0.002\u00b7n\u00b7lg n at n = 2048)');
	assert(!/4 100/.test(shorTable), 'the old \u2248 4 100 logical-qubit figure is gone');
	assert(/≈ 1\.2 hours per run/.test(shorTable), 'the finite-field DLP row reads ≈ 1.2 hours per run (Gidney & Ekerå Table 4, safe-prime short exponent, n = 2048)');
	assert(/9% retry risk/.test(shorTable), 'the DLP row carries Table 4\'s 9% retry risk');
	assert(/Table 4/.test(shorTable), 'the DLP row cites Table 4 rather than the paper\'s RSA headline');
	assert(!/2048-bit DH[\s\S]{0,200}?≈ 8 hours/.test(shorTable), 'the RSA 8-hour headline is no longer attached to the Diffie-Hellman row');
	assert(!/same modulus size/.test(shorTable), 'the "same modulus size" justification for reusing the RSA figure is gone');
	const rsaRow = (await page.locator('.shor-resources tbody tr').first().textContent()) ?? '';
	assert(/RSA-2048/.test(rsaRow) && /≈ 8 hours/.test(rsaRow), 'the 8-hour figure stays on the RSA-2048 factoring row');

	const contrastText = (await page.locator('.curve-contrast').textContent()) ?? '';
	assert(/19 = 18 points \+ \u221e/.test(contrastText), 'demo-curve group order is 19 = 18 affine points + \u221e');

	const hybridSecText = (await page.locator('.hybrid-security').textContent()) ?? '';
	assert(/mlkem_secret \u2016 x25519_secret/.test(hybridSecText), 'hybrid shared secret puts the ML-KEM half first (RFC 10024 \u00a7 4.3)');
	assert(/RFC 10024 \u00a7 4\.3/.test(hybridSecText), 'hybrid security argument cites RFC 10024 \u00a7 4.3');
	assert(/2,272 extra bytes/.test(hybridSecText), 'hybrid overhead is the lab\u2019s own 1,184 + 1,088 = 2,272 bytes');
	assert(!/~1\.2 KB extra\s*\n?\s*per handshake/.test(hybridSecText), 'the old "~1.2 KB extra per handshake" figure is gone');

	const decisionText = (await page.locator('.decision-grid').textContent()) ?? '';
	assert(/RFC 9846 \u00a7 9\.1/.test(decisionText) && /secp256r1/.test(decisionText), 'X25519 is a SHOULD and secp256r1 the MUST (RFC 9846 \u00a7 9.1)');
	assert(!/Default in TLS 1\.3/.test(decisionText), 'X25519 is no longer called the TLS 1.3 default');

	const historyText = (await page.locator('.hist-list').textContent()) ?? '';
	assert(/third-round alternate/.test(historyText) && /never a finalist/.test(historyText), 'SIKE is a third-round alternate and fourth-round candidate, not a finalist');
	assert(!/NIST-finalist/.test(historyText), 'the "NIST-finalist" SIKE claim is gone');

	const awsText = (await page.locator('#production .panel-card', { hasText: 'AWS KMS' }).textContent()) ?? '';
	assert(/7 April 2025/.test(awsText) && /2025/.test(awsText), 'AWS KMS hybrid ML-KEM is dated 7 April 2025');
	const cfText = ((await page.locator('#production .panel-card', { hasText: 'Cloudflare' }).textContent()) ?? '').trim();
	assert(/^2022/.test(cfText), 'Cloudflare post-quantum-by-default is dated 2022 (October 2022 post)');

	// Two generation panels carry corrected text; they render one at a time.
	await page.locator('#gen-tab-x25519').click();
	const x25519Detail = (await page.locator('.gen-detail').textContent()) ?? '';
	assert(/names no default group/.test(x25519Detail) && /SHOULD support X25519/.test(x25519Detail), 'X25519 panel states the RFC 9846 \u00a7 9.1 rule, not "the default"');
	await page.locator('#gen-tab-mlkem').click();
	const mlkemDetail = (await page.locator('.gen-detail').textContent()) ?? '';
	assert(/July 2022/.test(mlkemDetail) && /FIPS 203 in August 2024/.test(mlkemDetail), 'ML-KEM was selected July 2022 and standardised August 2024');
	await page.locator('#gen-tab-hybrid').click();
	const hybridDetail = (await page.locator('.gen-detail').textContent()) ?? '';
	assert(/H\(mlkemSecret \|\| x25519Secret\)/.test(hybridDetail), 'hybrid panel puts the ML-KEM secret first');
	await page.locator('#gen-tab-dh').click();

	// Copy buttons present on key outputs
	const copyChips = await page.locator('.copy-chip').count();
	assert(copyChips >= 3, `copy chips on key outputs (got ${copyChips})`);

	// Puzzles is the historical prequel after Generations, so every later
	// digit shortcut shifts by one: ECDH is now the sixth nav link.
	await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
	await page.keyboard.press('6');
	await page.waitForTimeout(400);
	const hashAfter6 = await page.evaluate(() => window.location.hash);
	assert(hashAfter6 === '#ecdh', `key '6' jumps to ECDH (hash=${hashAfter6})`);

	// "?" opens help dialog
	await page.keyboard.press('?');
	const helpVisible = await page.locator('.kbd-help').isVisible();
	assert(helpVisible, 'pressing ? opens keyboard-shortcuts help');
	await page.keyboard.press('Escape');
	const helpHiddenAfterEsc = await page.locator('.kbd-help[hidden]').count();
	assert(helpHiddenAfterEsc === 1, 'Escape closes help');

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
