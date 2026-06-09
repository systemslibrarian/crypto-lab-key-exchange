// axe-core accessibility audit against the live preview build.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core'), 'utf8');

const URL = 'http://localhost:4173/crypto-lab-key-exchange/';

async function audit(label, viewport, theme) {
	console.log(`\n=== axe: ${label} (${theme}) ===`);
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ viewport });
	// Seed theme in localStorage before the page boots so the anti-flash
	// script picks it up on first paint.
	await ctx.addInitScript((t) => {
		try { localStorage.setItem('theme', t); } catch {}
	}, theme);
	const page = await ctx.newPage();
	await page.goto(URL, { waitUntil: 'networkidle' });
	await page.waitForFunction(
		() => /agree:/.test(document.querySelector('#kem-output')?.textContent ?? ''),
	);
	await page.addScriptTag({ content: axeSource });
	const result = await page.evaluate(async () => {
		// @ts-ignore
		return await window.axe.run(document, {
			runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
		});
	});
	const v = result.violations;
	if (v.length === 0) {
		console.log('ok  : no WCAG 2.1 A/AA violations');
	} else {
		console.error(`FAIL: ${v.length} violation(s)`);
		for (const violation of v) {
			console.error(`  - [${violation.impact}] ${violation.id}: ${violation.help}`);
			for (const node of violation.nodes.slice(0, 3)) {
				console.error(`      target: ${node.target.join(' ')}`);
			}
		}
		process.exitCode = 1;
	}
	console.log(`     passes: ${result.passes.length}, incomplete: ${result.incomplete.length}`);
	for (const inc of result.incomplete) {
		console.log(`     incomplete: ${inc.id} — ${inc.help} (${inc.nodes.length} node${inc.nodes.length === 1 ? '' : 's'})`);
	}
	await browser.close();
}

await audit('desktop 1280', { width: 1280, height: 800 }, 'light');
await audit('desktop 1280', { width: 1280, height: 800 }, 'dark');
await audit('mobile 390', { width: 390, height: 844 }, 'light');
await audit('mobile 390', { width: 390, height: 844 }, 'dark');
await audit('narrow 360', { width: 360, height: 740 }, 'light');
await audit('narrow 360', { width: 360, height: 740 }, 'dark');

if (process.exitCode) console.error('\nAXE: FAIL');
else console.log('\nAXE: PASS');
