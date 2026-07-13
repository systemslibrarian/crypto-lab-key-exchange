// ui.ts — Key Exchange Evolution interactive UI.
//
// Mounts a single `mountApp(root)` that renders the demo. Sections are
// built with the suite-standard classes from style.css; anything genuinely
// new (timeline rail, chips, point displays, attack output) gets a class
// in extra.css that styles in terms of the existing CSS variables.

import {
	DEMO_CURVE,
	diffieHellman,
	discreteLogAttack,
	ecAdd,
	ecdh,
	hybridCombine,
	INFINITY,
	isOnCurve,
	mlkemEncapsulateDemo,
	modPow,
	pointToString,
	type Curve,
	type DhResult,
	type ECPoint,
	type EcdhResult,
	type KemResult,
} from './engine.ts';
import {
	DEPLOYMENTS,
	GENERATIONS,
	GLOSSARY,
	HISTORY,
	REFERENCES,
	SIZES,
	type Generation,
} from './data.ts';

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	html?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (html !== undefined) node.innerHTML = html;
	return node;
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
	const n = parseInt(value, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

// Inline copy-to-clipboard button.  Wraps any value in a small chip with a
// "Copy" button that flips to "Copied" for ~1.4s on success.  Returns a
// raw HTML string so it can be embedded inside the existing innerHTML
// builders; wiring happens via the global delegate set up in mountApp.
function copyChip(value: string, label = 'Copy'): string {
	// HTML-escape the value for the data-attribute and the visible chip.
	const safe = value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
	return `<button type="button" class="copy-chip" data-copy="${safe}" aria-label="Copy ${label} to clipboard">📋 ${label}</button>`;
}

// Threat-model chip strip. Every interactive section gets an explicit
// statement of which adversary it does (and does not) protect against.
type Threat = 'passive' | 'active' | 'quantum' | 'migration';
const THREAT_LABEL: Record<Threat, string> = {
	passive: 'Passive eavesdropper',
	active: 'Active MitM',
	quantum: 'Large quantum computer',
	migration: 'Harvest-now-decrypt-later',
};
function threatBadges(protects: Threat[], doesNot: Threat[]): string {
	const yes = protects
		.map((t) => `<span class="threat-chip threat-chip--yes">✓ vs ${THREAT_LABEL[t]}</span>`)
		.join('');
	const no = doesNot
		.map((t) => `<span class="threat-chip threat-chip--no">✗ vs ${THREAT_LABEL[t]}</span>`)
		.join('');
	return `<div class="threat-strip" role="note" aria-label="Threat model for this section">${yes}${no}</div>`;
}

// Standardised "this section uses toy parameters" warning so the caveat
// is visible in every interactive panel, not just buried in prose.
function toyBanner(detail: string): string {
	return `
		<div class="toy-banner" role="note">
			<span class="toy-banner-tag">Toy parameters</span>
			<span class="toy-banner-body">${detail}</span>
		</div>
	`;
}

function wireCopyButtons(root: HTMLElement): void {
	root.addEventListener('click', async (e) => {
		const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.copy-chip');
		if (!target) return;
		const value = target.dataset.copy ?? '';
		try {
			await navigator.clipboard.writeText(value);
			const original = target.innerHTML;
			target.innerHTML = '✓ Copied';
			target.classList.add('copy-chip--ok');
			setTimeout(() => {
				target.innerHTML = original;
				target.classList.remove('copy-chip--ok');
			}, 1400);
		} catch {
			target.innerHTML = '✗ Failed';
			setTimeout(() => {
				target.innerHTML = '📋 Copy';
			}, 1400);
		}
	});
}

// ---------- 1. Hero ----------------------------------------------------------

function renderHero(): HTMLElement {
	const hero = el('header', 'cl-hero');
	// The #theme-toggle button is hidden by the shared topbar (its toggle
	// replaces it) but must stay in the DOM so initThemeToggle() keeps working.
	hero.innerHTML = `
		<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to light mode">🌙</button>
		<div class="cl-hero-main">
			<h1 class="cl-hero-title">Key Exchange</h1>
			<p class="cl-hero-sub">DH · ECDH · X25519 · ML-KEM · Hybrid</p>
			<p class="cl-hero-desc">Walk the five generations of agreeing on a shared secret over an open channel — run live DH and ECDH, break discrete log on toy parameters, and trace ML-KEM encapsulation and the hybrid X25519+ML-KEM combine.</p>
		</div>
		<aside class="cl-hero-why" aria-label="Why it matters">
			<span class="cl-hero-why-label">WHY IT MATTERS</span>
			<p class="cl-hero-why-text">The post-quantum move isn't a bigger key — it's a different mechanism. Shor's algorithm breaks discrete-log key agreement in any group, so ML-KEM's lattice hardness, wrapped in a hybrid, is what protects data being harvested today for decryption later.</p>
		</aside>
	`;
	return hero;
}

// ---------- 2. Generation timeline -------------------------------------------

function renderTimeline(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'generations';
	section.setAttribute('aria-labelledby', 'generations-heading');

	const header = el('div', 'section-heading-row');
	header.innerHTML = `
		<div>
			<p class="section-kicker">Section · 1</p>
			<h2 id="generations-heading">Five generations</h2>
			<p class="panel-copy">Click a generation to see its mechanic, the hard problem it leans on, the typical key size, what drove the next move, and how it fares against quantum.</p>
		</div>
	`;
	section.appendChild(header);

	const list = el('div', 'gen-rail');
	list.setAttribute('role', 'tablist');
	list.setAttribute('aria-label', 'Generations of key exchange');

	const panelId = 'gen-detail-panel';
	const detail = el('div', 'gen-detail');
	detail.id = panelId;
	detail.setAttribute('role', 'tabpanel');
	detail.tabIndex = 0;

	const buttons: HTMLButtonElement[] = GENERATIONS.map((gen, idx) => {
		const btn = el('button', 'gen-pill');
		btn.type = 'button';
		btn.id = `gen-tab-${gen.id}`;
		btn.setAttribute('role', 'tab');
		btn.setAttribute('aria-selected', 'false');
		btn.setAttribute('aria-controls', panelId);
		btn.tabIndex = -1;
		btn.dataset.id = gen.id;
		btn.innerHTML = `
			<span class="gen-pill-year">${gen.year}</span>
			<span class="gen-pill-name">${gen.name}</span>
			<span class="gen-pill-chip ${gen.pqSafe ? 'chip-safe' : 'chip-broken'}">${gen.pqSafe ? 'PQ-safe' : 'Quantum-broken'}</span>
		`;
		btn.addEventListener('click', () => select(idx));
		btn.addEventListener('keydown', (e: KeyboardEvent) => {
			const last = buttons.length - 1;
			let next = -1;
			if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = idx === last ? 0 : idx + 1;
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = idx === 0 ? last : idx - 1;
			else if (e.key === 'Home') next = 0;
			else if (e.key === 'End') next = last;
			if (next >= 0) {
				e.preventDefault();
				select(next);
				buttons[next]!.focus();
			}
		});
		return btn;
	});

	buttons.forEach((b) => list.appendChild(b));
	section.appendChild(list);
	section.appendChild(detail);

	function select(idx: number): void {
		buttons.forEach((b, i) => {
			const active = i === idx;
			b.classList.toggle('is-active', active);
			b.setAttribute('aria-selected', String(active));
			b.tabIndex = active ? 0 : -1;
		});
		const gen = GENERATIONS[idx]!;
		detail.innerHTML = renderGenerationDetail(gen);
		detail.setAttribute('aria-labelledby', `gen-tab-${gen.id}`);
	}

	select(0);
	return section;
}

function renderGenerationDetail(g: Generation): string {
	const chip = g.pqSafe
		? `<span class="gen-pill-chip chip-safe">Post-quantum safe</span>`
		: `<span class="gen-pill-chip chip-broken">Broken by Shor</span>`;
	return `
		<div class="gen-detail-head">
			<div>
				<p class="hero-metric-label">${g.year} · ${g.name}</p>
				<h3>${g.name}</h3>
			</div>
			${chip}
		</div>
		<dl class="gen-dl">
			<dt>Mechanic</dt><dd>${g.mechanic}</dd>
			<dt>Hard problem</dt><dd>${g.hardProblem}</dd>
			<dt>Key size</dt><dd>${g.keySize}</dd>
			<dt>What drove the next move</dt><dd>${g.drove}</dd>
			<dt>Quantum threat</dt><dd>${g.threat}</dd>
		</dl>
	`;
}

// ---------- 3. DH playground -------------------------------------------------

function renderDhPlayground(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'dh';
	section.setAttribute('aria-labelledby', 'dh-heading');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 2</p>
				<h2 id="dh-heading">Live Diffie–Hellman</h2>
				<p class="panel-copy">Pick a small prime <code>p</code>, a generator <code>g</code>, and Alice’s and Bob’s secret exponents. Every step of the arithmetic is shown — and the discrete-log attack actually runs.</p>
			</div>
		</div>
		${threatBadges(['passive'], ['active', 'quantum'])}
		${toyBanner('Real DH uses 2048–4096-bit primes; this demo uses ≤ 4-digit primes so the math fits on screen and the break runs in milliseconds.')}
		<div class="kx-inputs" role="group" aria-label="Diffie–Hellman inputs">
			<label>
				<span>Prime <code>p</code></span>
				<input type="number" id="dh-p" min="3" max="9973" value="23" />
			</label>
			<label>
				<span>Generator <code>g</code></span>
				<input type="number" id="dh-g" min="2" value="5" />
			</label>
			<label>
				<span>Alice secret <code>a</code></span>
				<input type="number" id="dh-a" min="1" value="6" />
			</label>
			<label>
				<span>Bob secret <code>b</code></span>
				<input type="number" id="dh-b" min="1" value="15" />
			</label>
		</div>
		<div id="dh-output" class="kx-output" aria-live="polite"></div>
		<div class="kx-actions">
			<button id="dh-attack" class="tab-button" type="button">Break it (brute-force discrete log)</button>
		</div>
		<div id="dh-attack-output" class="attack-output" aria-live="polite"></div>
	`;

	const pInput = section.querySelector<HTMLInputElement>('#dh-p')!;
	const gInput = section.querySelector<HTMLInputElement>('#dh-g')!;
	const aInput = section.querySelector<HTMLInputElement>('#dh-a')!;
	const bInput = section.querySelector<HTMLInputElement>('#dh-b')!;
	const output = section.querySelector<HTMLElement>('#dh-output')!;
	const attackBtn = section.querySelector<HTMLButtonElement>('#dh-attack')!;
	const attackOut = section.querySelector<HTMLElement>('#dh-attack-output')!;

	function read(): { p: number; g: number; a: number; b: number } {
		const p = clampInt(pInput.value, 3, 9973, 23);
		const g = clampInt(gInput.value, 2, p - 1, 5);
		const a = clampInt(aInput.value, 1, p - 1, 6);
		const b = clampInt(bInput.value, 1, p - 1, 15);
		return { p, g, a, b };
	}

	function rerun(): void {
		const { p, g, a, b } = read();
		const r = diffieHellman(p, g, a, b);
		output.innerHTML = renderDhResult(r);
		attackOut.innerHTML = '';
		// Let the hybrid section refresh its classical-half provenance chip
		// (and re-derive the session key) when the DH secret changes here.
		window.dispatchEvent(new CustomEvent('kx-state-changed'));
	}

	[pInput, gInput, aInput, bInput].forEach((i) => i.addEventListener('input', rerun));

	attackBtn.addEventListener('click', () => {
		const { p, g, a, b } = read();
		const A = diffieHellman(p, g, a, b).A;
		const recovered = discreteLogAttack(g, A, p);
		// Re-run with a counter so we can show how many operations the
		// brute force actually took.
		let iterations = 0;
		for (let x = 1; x < p; x++) {
			iterations++;
			if (modPow(g, x, p) === A) break;
		}
		attackOut.innerHTML = renderDhAttack(recovered, a, A, g, p, iterations);
	});

	rerun();
	return section;
}

function renderDhResult(r: DhResult): string {
	const status = r.agree
		? `<span class="scenario-status--valid">✓ Both sides agree</span>`
		: `<span class="scenario-status--invalid">✗ Disagree (bad inputs)</span>`;
	return `
		<div class="kx-grid">
			<div class="kx-side">
				<p class="hero-metric-label">Alice</p>
				<p class="mono-inline">A = g<sup>a</sup> mod p = ${r.g}<sup>${r.a}</sup> mod ${r.p} = <strong>${r.A}</strong></p>
				<p class="mono-inline">shared = B<sup>a</sup> mod p = ${r.B}<sup>${r.a}</sup> mod ${r.p} = <strong>${r.sharedFromAlice}</strong> ${copyChip(String(r.sharedFromAlice), 'shared')}</p>
			</div>
			<div class="kx-side">
				<p class="hero-metric-label">Bob</p>
				<p class="mono-inline">B = g<sup>b</sup> mod p = ${r.g}<sup>${r.b}</sup> mod ${r.p} = <strong>${r.B}</strong></p>
				<p class="mono-inline">shared = A<sup>b</sup> mod p = ${r.A}<sup>${r.b}</sup> mod ${r.p} = <strong>${r.sharedFromBob}</strong> ${copyChip(String(r.sharedFromBob), 'shared')}</p>
			</div>
		</div>
		${renderDhWhyMatch(r)}
		<p class="kx-status">${status}</p>
	`;
}

// The single most important intuition in DH: WHY two people who never shared a
// secret arrive at the same number. Neither exponentiation on its own explains
// it — the reason is that the two exponent towers commute to the SAME g^(ab).
// We render Alice's tower and Bob's tower side by side and collapse both to
// g^(a·b), highlighting the exponents so the commutativity is the visible fact,
// not the green checkmark below it.
function renderDhWhyMatch(r: DhResult): string {
	const ab = r.a * r.b;
	// g^(ab) mod p, computed directly, must equal both shared values — this is
	// the number both towers land on. Shown so the learner can verify by hand.
	const gab = modPow(r.g, ab, r.p);
	const agreeReal = gab === r.sharedFromAlice && gab === r.sharedFromBob;
	return `
		<div class="dh-why" role="note" aria-label="Why Alice and Bob compute the same secret">
			<p class="dh-why-title">Why do they match? Follow the exponents.</p>
			<div class="dh-why-rows">
				<p class="dh-why-row">
					<span class="dh-why-who">Alice takes Bob's B and raises it to <em>a</em>:</span>
					<span class="dh-why-math">B<sup>a</sup> = (g<sup class="expo expo-b">b</sup>)<sup class="expo expo-a">a</sup> = g<sup class="expo"><span class="expo-b">b</span>·<span class="expo-a">a</span></sup></span>
				</p>
				<p class="dh-why-row">
					<span class="dh-why-who">Bob takes Alice's A and raises it to <em>b</em>:</span>
					<span class="dh-why-math">A<sup>b</sup> = (g<sup class="expo expo-a">a</sup>)<sup class="expo expo-b">b</sup> = g<sup class="expo"><span class="expo-a">a</span>·<span class="expo-b">b</span></sup></span>
				</p>
				<p class="dh-why-collapse">
					<span class="dh-why-math">Multiplying exponents commutes: <span class="expo-a">${r.a}</span>·<span class="expo-b">${r.b}</span> = <span class="expo-b">${r.b}</span>·<span class="expo-a">${r.a}</span> = ${ab},
					so both are <strong>g<sup class="expo">a·b</sup> = ${r.g}<sup>${ab}</sup> mod ${r.p} = ${gab}</strong>.</span>
				</p>
			</div>
			<p class="dh-why-foot ${agreeReal ? 'scenario-status--valid' : 'scenario-status--invalid'}">
				${agreeReal
					? '✓ The shared secret is g^(a·b) — never sent on the wire, only computable by someone who knows a or b.'
					: '✗ Inputs out of range for this identity — pick a, b in [1, p−1].'}
			</p>
		</div>
	`;
}

function renderDhAttack(
	recovered: number | null,
	real: number,
	A: number,
	g: number,
	p: number,
	iterations: number,
): string {
	if (recovered === null) {
		return `<p class="scenario-status--invalid">Brute force found no exponent — check inputs (g should be a generator mod p).</p>`;
	}
	const matches = recovered === real;
	// Estimate human-scale time at 10^9 modular exponentiations per second
	// (optimistic single-core; index-calculus is much faster than naive
	// brute force, but for teaching purposes the naive view is what we ran).
	const opsPerSec = 1e9;
	const ageOfUniverseSec = 4.35e17; // ~13.8 billion years
	function fmtTime(ops: number): string {
		const sec = ops / opsPerSec;
		if (sec < 1e-6) return `< 1 µs`;
		if (sec < 1e-3) return `< 1 ms`;
		if (sec < 1) return `${(sec * 1000).toFixed(1)} ms`;
		if (sec < 60) return `${sec.toFixed(1)} s`;
		if (sec < 3600) return `${(sec / 60).toFixed(1)} min`;
		if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
		if (sec < 86400 * 365) return `${(sec / 86400).toFixed(1)} days`;
		if (sec < 86400 * 365 * 1e6) return `${(sec / (86400 * 365)).toFixed(1)} years`;
		const universes = sec / ageOfUniverseSec;
		if (universes < 1e9) return `${universes.toExponential(1)} × age of universe`;
		return `≫ age of universe`;
	}
	function fmtOps(ops: number): string {
		if (ops < 1e6) return ops.toLocaleString();
		return ops.toExponential(1);
	}
	const tiers = [
		{ label: 'Your demo run', bits: Math.ceil(Math.log2(p)), ops: iterations, here: true },
		{ label: 'Hobby laptop, 2^32 bits', bits: 32, ops: 2 ** 32, here: false },
		{ label: '64-bit prime', bits: 64, ops: 2 ** 64, here: false },
		{ label: '1024-bit DH (broken)', bits: 1024, ops: 2 ** 110, here: false }, // ~ index-calculus effort
		{ label: '2048-bit DH (production)', bits: 2048, ops: 2 ** 160, here: false },
	];
	const rows = tiers
		.map(
			(t) => `
		<tr class="${t.here ? 'scale-row scale-row--here' : 'scale-row'}">
			<td>${t.here ? '<strong>← you are here</strong> ' : ''}${t.label}</td>
			<td class="mono-cell">${t.bits} bits</td>
			<td class="mono-cell">${fmtOps(t.ops)}</td>
			<td class="mono-cell">${fmtTime(t.ops)}</td>
		</tr>
	`,
		)
		.join('');
	return `
		<div class="attack-card">
			<p class="hero-metric-label">Eve, watching the wire</p>
			<p class="mono-inline">Observed: g=${g}, p=${p}, A=${A}</p>
			<p class="mono-inline">Brute force: try x = 1, 2, … until g<sup>x</sup> mod p = A</p>
			<p class="mono-inline">Recovered Alice’s secret: <strong>x = ${recovered}</strong> ${matches ? '✓' : '(matches a different exponent in same residue class)'}</p>
			<p class="mono-inline">Iterations needed: <strong>${iterations}</strong></p>
			<h3 class="attack-table-heading">How this scales</h3>
			<div class="table-shell" tabindex="0" role="region" aria-label="Discrete-log brute-force scaling table">
				<table class="math-table scale-table">
					<thead><tr><th>Setting</th><th>Prime size</th><th>Operations</th><th>Time at 10⁹ ops/s</th></tr></thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
			<p class="kx-footnote">The naive brute force above scales linearly with <code>p</code>; the best classical attack (index calculus) is sub-exponential, but real-DH primes are still chosen so even that takes longer than the age of the universe. Shor’s quantum algorithm collapses both to polynomial time.</p>
		</div>
	`;
}

// ---------- 3b. MitM panel ---------------------------------------------------

// The classic critique of textbook DH: confidentiality against a passive
// eavesdropper, NOTHING about authentication. Eve sits in the middle and
// runs TWO DH exchanges — Alice ↔ Eve and Eve ↔ Bob — so each end thinks
// they share a secret with the other, but really they share a secret with
// Eve. Alice and Bob never compute the same value.
function renderMitm(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'mitm';
	section.setAttribute('aria-labelledby', 'mitm-heading');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 3</p>
				<h2 id="mitm-heading">What DH does NOT give you</h2>
				<p class="panel-copy">DH protects against a passive eavesdropper who only watches the wire. It gives <em>zero</em> protection against an active attacker who can intercept and replace messages. Watch Eve sit in the middle and trick both sides into sharing a secret with <em>her</em>.</p>
			</div>
		</div>
		${threatBadges([], ['active'])}
		<div class="kx-inputs" role="group" aria-label="MitM inputs">
			<label>
				<span>Prime <code>p</code></span>
				<input type="number" id="mitm-p" min="3" max="9973" value="23" />
			</label>
			<label>
				<span>Generator <code>g</code></span>
				<input type="number" id="mitm-g" min="2" value="5" />
			</label>
			<label>
				<span>Alice secret <code>a</code></span>
				<input type="number" id="mitm-a" min="1" value="6" />
			</label>
			<label>
				<span>Bob secret <code>b</code></span>
				<input type="number" id="mitm-b" min="1" value="15" />
			</label>
			<label>
				<span>Eve→Alice <code>e₁</code></span>
				<input type="number" id="mitm-e1" min="1" value="4" />
			</label>
			<label>
				<span>Eve→Bob <code>e₂</code></span>
				<input type="number" id="mitm-e2" min="1" value="11" />
			</label>
		</div>
		<div id="mitm-output" class="kx-output" aria-live="polite"></div>
	`;

	const fields = ['p', 'g', 'a', 'b', 'e1', 'e2'] as const;
	const inputs = Object.fromEntries(
		fields.map((f) => [f, section.querySelector<HTMLInputElement>(`#mitm-${f}`)!]),
	) as Record<(typeof fields)[number], HTMLInputElement>;
	const output = section.querySelector<HTMLElement>('#mitm-output')!;

	function rerun(): void {
		const p = clampInt(inputs.p.value, 3, 9973, 23);
		const g = clampInt(inputs.g.value, 2, p - 1, 5);
		const a = clampInt(inputs.a.value, 1, p - 1, 6);
		const b = clampInt(inputs.b.value, 1, p - 1, 15);
		const e1 = clampInt(inputs.e1.value, 1, p - 1, 4);
		const e2 = clampInt(inputs.e2.value, 1, p - 1, 11);

		// Honest values each party WOULD compute on a clean wire.
		const A = modPow(g, a, p);
		const B = modPow(g, b, p);
		// Eve's substituted public values, masquerading as Bob/Alice.
		const E1 = modPow(g, e1, p); // Eve's "I am Bob" key, sent to Alice
		const E2 = modPow(g, e2, p); // Eve's "I am Alice" key, sent to Bob
		// What each end computes after Eve's swap.
		const aliceShared = modPow(E1, a, p); // Alice thinks: g^(a·b); really: g^(a·e1)
		const bobShared = modPow(E2, b, p); // Bob thinks: g^(b·a); really: g^(b·e2)
		// What Eve computes — both halves, because she knows e1 and e2.
		const eveWithAlice = modPow(A, e1, p); // = g^(a·e1) = Alice's view
		const eveWithBob = modPow(B, e2, p); // = g^(b·e2) = Bob's view

		const matchAlice = aliceShared === eveWithAlice;
		const matchBob = bobShared === eveWithBob;
		const aliceBob = aliceShared === bobShared;

		output.innerHTML = `
			<div class="mitm-diagram" aria-hidden="true">
				<div class="mitm-party mitm-party--alice">
					<p class="hero-metric-label">Alice</p>
					<p class="mono-inline">sees “Bob's” key: E₁ = ${E1}</p>
					<p class="mono-inline">computes: <strong>${aliceShared}</strong></p>
				</div>
				<div class="mitm-party mitm-party--eve">
					<p class="hero-metric-label">Eve (in the middle)</p>
					<p class="mono-inline">with Alice: A<sup>e₁</sup> = <strong>${eveWithAlice}</strong></p>
					<p class="mono-inline">with Bob: B<sup>e₂</sup> = <strong>${eveWithBob}</strong></p>
				</div>
				<div class="mitm-party mitm-party--bob">
					<p class="hero-metric-label">Bob</p>
					<p class="mono-inline">sees “Alice's” key: E₂ = ${E2}</p>
					<p class="mono-inline">computes: <strong>${bobShared}</strong></p>
				</div>
			</div>
			<dl class="mitm-checks">
				<dt>Alice's secret matches what Eve has</dt>
				<dd class="${matchAlice ? 'scenario-status--invalid' : 'scenario-status--valid'}">${matchAlice ? '✗ Eve can decrypt Alice→Bob' : '✓ Mismatch (good for Alice)'}</dd>
				<dt>Bob's secret matches what Eve has</dt>
				<dd class="${matchBob ? 'scenario-status--invalid' : 'scenario-status--valid'}">${matchBob ? '✗ Eve can decrypt Bob→Alice' : '✓ Mismatch (good for Bob)'}</dd>
				<dt>Alice and Bob computed the same secret</dt>
				<dd class="${aliceBob ? 'scenario-status--valid' : 'scenario-status--invalid'}">${aliceBob ? '✓ Same (degenerate case — try different e₁, e₂)' : '✗ Different secrets — they are talking to Eve, not each other'}</dd>
			</dl>
			<p class="kx-footnote"><strong>The fix is authentication, not better key exchange.</strong> TLS signs the DH/ECDH/X25519 public values with the server's certificate; Signal authenticates via the long-term identity key; IPsec uses pre-shared keys or PKI. Without one of those, every "secure channel" protocol — classical or post-quantum — is just a private channel to whoever is in the middle.</p>
		`;
	}

	Object.values(inputs).forEach((i) => i.addEventListener('input', rerun));
	rerun();
	return section;
}

// ---------- 4. ECDH playground -----------------------------------------------

function renderEcdhPlayground(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'ecdh';
	section.setAttribute('aria-labelledby', 'ecdh-heading');

	const c = DEMO_CURVE;

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 4</p>
				<h2 id="ecdh-heading">Live ECDH</h2>
				<p class="panel-copy">The same Diffie–Hellman idea, on an elliptic curve. We use a tiny teaching curve so every point is visible.</p>
			</div>
		</div>
		${threatBadges(['passive'], ['active', 'quantum'])}
		${toyBanner('y² = x³ + 2x + 2 (mod 17) is a 4-bit teaching curve with 19 points. Production ECDH uses Curve25519 (256-bit prime, ~2²⁵² points).')}
		<p class="kx-curve">
			<span class="kx-curve-part">Curve: <code>y² = x³ + ${c.a}x + ${c.b} (mod ${c.p})</code></span>
			<span class="kx-curve-part">generator <code>G = ${pointToString(c.G)}</code></span>
			<span class="kx-curve-part">order <code>n = ${c.n}</code></span>
		</p>
		<div class="kx-inputs" role="group" aria-label="ECDH inputs">
			<label>
				<span>Alice scalar <code>a</code></span>
				<input type="number" id="ec-a" min="1" max="${c.n - 1}" value="3" />
			</label>
			<label>
				<span>Bob scalar <code>b</code></span>
				<input type="number" id="ec-b" min="1" max="${c.n - 1}" value="9" />
			</label>
		</div>
		<div class="ec-walk-controls">
			<button id="ec-walk" class="tab-button" type="button">▶ Walk a·G one hop at a time</button>
			<p class="ec-walk-hint" id="ec-walk-hint">Scalar multiplication <code>a·G</code> means adding <code>G</code> to itself <code>a</code> times: <code>G → 2G → 3G → …</code>. Watch the hops jump around the group — that unpredictable walk is what makes the discrete-log inversion hard.</p>
		</div>
		<div class="ec-grid">
			<div id="ec-output" class="kx-output" aria-live="polite"></div>
			<div class="ec-plot-wrap">
				<div id="ec-plot" role="img" aria-label="Plot of all 18 points on the demo curve plus the point at infinity, with G, a·G, b·G, and the shared point highlighted"></div>
				<p id="ec-walk-step" class="ec-walk-step" aria-live="polite"></p>
				<ul class="ec-legend" aria-label="Point legend">
					<li><span class="ec-dot ec-dot--curve"></span>Other curve points</li>
					<li><span class="ec-dot ec-dot--g"></span>G = (5, 1)</li>
					<li><span class="ec-dot ec-dot--a"></span>A = a·G</li>
					<li><span class="ec-dot ec-dot--b"></span>B = b·G</li>
					<li><span class="ec-dot ec-dot--shared"></span>shared = a·B = b·A</li>
				</ul>
			</div>
		</div>
		<h3 class="curve-contrast-heading">Demo curve vs Curve25519</h3>
		<div class="table-shell" tabindex="0" role="region" aria-label="Demo curve vs Curve25519 comparison">
			<table class="math-table curve-contrast">
				<thead><tr><th>Property</th><th>This demo</th><th>Curve25519 (production)</th></tr></thead>
				<tbody>
					<tr><td>Prime <code>p</code></td><td class="mono-cell">17</td><td class="mono-cell">2²⁵⁵ − 19</td></tr>
					<tr><td>Curve equation</td><td class="mono-cell">y² = x³ + 2x + 2</td><td class="mono-cell">y² = x³ + 486662 x² + x (Montgomery)</td></tr>
					<tr><td>Generator</td><td class="mono-cell">(5, 1)</td><td class="mono-cell">u = 9 (Montgomery x-coord)</td></tr>
					<tr><td>Group order <code>n</code></td><td class="mono-cell">19 points + ∞</td><td class="mono-cell">≈ 2²⁵²</td></tr>
					<tr><td>Bits of classical security</td><td class="mono-cell">≈ 2 (broken instantly)</td><td class="mono-cell">≈ 128 (production target)</td></tr>
					<tr><td>Public key size</td><td class="mono-cell">1 byte</td><td class="mono-cell">32 bytes</td></tr>
					<tr><td>Year / author</td><td class="mono-cell">teaching only</td><td class="mono-cell">2006, D. J. Bernstein</td></tr>
				</tbody>
			</table>
		</div>
	`;

	const aInput = section.querySelector<HTMLInputElement>('#ec-a')!;
	const bInput = section.querySelector<HTMLInputElement>('#ec-b')!;
	const output = section.querySelector<HTMLElement>('#ec-output')!;
	const plot = section.querySelector<HTMLElement>('#ec-plot')!;
	const walkBtn = section.querySelector<HTMLButtonElement>('#ec-walk')!;
	const walkStep = section.querySelector<HTMLElement>('#ec-walk-step')!;

	// Cancellation token so restarting or re-running clears a walk in flight.
	let walkTimer: number | null = null;

	function cancelWalk(): void {
		if (walkTimer !== null) {
			window.clearTimeout(walkTimer);
			walkTimer = null;
		}
	}

	// Build the sequence of partial points 1·G, 2·G, …, a·G by iterated
	// addition (P_{k+1} = P_k + G) — the definition of scalar multiplication.
	// This is the exact walk that makes ECDLP hard: each hop lands on a
	// point that looks unrelated to the last.
	function scalarWalk(a: number): ECPoint[] {
		const seq: ECPoint[] = [];
		let acc: ECPoint = INFINITY;
		for (let k = 0; k < a; k++) {
			acc = ecAdd(acc, c.G, c);
			seq.push(acc);
		}
		return seq;
	}

	function rerun(): void {
		cancelWalk();
		walkStep.textContent = '';
		const a = clampInt(aInput.value, 1, c.n - 1, 3);
		const b = clampInt(bInput.value, 1, c.n - 1, 9);
		const r = ecdh(c, a, b);
		output.innerHTML = renderEcdhResult(r);
		plot.innerHTML = renderCurvePlot(c, r);
	}

	function runWalk(): void {
		cancelWalk();
		const a = clampInt(aInput.value, 1, c.n - 1, 3);
		const b = clampInt(bInput.value, 1, c.n - 1, 9);
		const r = ecdh(c, a, b);
		const seq = scalarWalk(a);
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		walkBtn.disabled = true;
		walkBtn.setAttribute('aria-busy', 'true');

		const stepTo = (upto: number): void => {
			// Redraw the plot with the walk path revealed up to `upto` hops.
			plot.innerHTML = renderCurvePlot(c, r, seq, upto);
			const pt = seq[upto - 1]!;
			walkStep.textContent =
				upto < a
					? `Hop ${upto} of ${a}:  ${upto}·G = ${pointToString(pt)}`
					: `Arrived: ${a}·G = A = ${pointToString(pt)}. From G you could not have guessed a = ${a} from where you landed — that is ECDLP.`;
		};

		if (reduced) {
			// No animation: draw the full path at once, still numbered.
			stepTo(a);
			walkBtn.disabled = false;
			walkBtn.removeAttribute('aria-busy');
			return;
		}

		let i = 1;
		const tick = (): void => {
			stepTo(i);
			if (i >= a) {
				walkBtn.disabled = false;
				walkBtn.removeAttribute('aria-busy');
				walkTimer = null;
				return;
			}
			i++;
			walkTimer = window.setTimeout(tick, 650);
		};
		tick();
	}

	[aInput, bInput].forEach((i) => i.addEventListener('input', rerun));
	walkBtn.addEventListener('click', runWalk);

	rerun();
	return section;
}

// All (x, y) with 0 ≤ x, y < p satisfying the curve equation. With p=17
// this yields 18 finite points plus the point at infinity — small enough
// to enumerate and plot.
function enumerateCurvePoints(curve: Curve): ECPoint[] {
	const points: ECPoint[] = [];
	for (let x = 0; x < curve.p; x++) {
		for (let y = 0; y < curve.p; y++) {
			if (isOnCurve({ x, y }, curve)) points.push({ x, y });
		}
	}
	return points;
}

function renderCurvePlot(
	curve: Curve,
	r: EcdhResult,
	walk?: ECPoint[],
	upto = 0,
): string {
	const points = enumerateCurvePoints(curve);
	const W = 320;
	const H = 320;
	const pad = 28;
	const span = curve.p - 1;
	const sx = (x: number) => pad + (x / span) * (W - 2 * pad);
	const sy = (y: number) => H - pad - (y / span) * (H - 2 * pad);

	function classify(pt: ECPoint): string {
		if (pt.x === curve.G.x && pt.y === curve.G.y) return 'ec-dot--g';
		if (!r.A.infinity && pt.x === r.A.x && pt.y === r.A.y) return 'ec-dot--a';
		if (!r.B.infinity && pt.x === r.B.x && pt.y === r.B.y) return 'ec-dot--b';
		if (!r.sharedFromAlice.infinity && pt.x === r.sharedFromAlice.x && pt.y === r.sharedFromAlice.y)
			return 'ec-dot--shared';
		return 'ec-dot--curve';
	}

	const axes = `
		<line class="ec-axis" x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" />
		<line class="ec-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" />
		<text class="ec-axis-label" x="${W - pad + 6}" y="${H - pad + 4}">x</text>
		<text class="ec-axis-label" x="${pad - 6}" y="${pad - 6}" text-anchor="end">y</text>
		<text class="ec-axis-label" x="${pad - 4}" y="${H - pad + 14}" text-anchor="end">0</text>
		<text class="ec-axis-label" x="${W - pad}" y="${H - pad + 14}" text-anchor="middle">${span}</text>
		<text class="ec-axis-label" x="${pad - 4}" y="${pad + 4}" text-anchor="end">${span}</text>
	`;

	const dots = points
		.map((pt) => {
			const cls = classify(pt);
			const radius = cls === 'ec-dot--curve' ? 4 : 7;
			return `<circle class="ec-svg-dot ${cls}" cx="${sx(pt.x)}" cy="${sy(pt.y)}" r="${radius}"><title>(${pt.x}, ${pt.y})</title></circle>`;
		})
		.join('');

	// Optional infinity marker tucked in the top-right corner.
	const infinityMarker = `
		<text class="ec-infty" x="${W - pad + 4}" y="${pad - 8}" text-anchor="end">∞</text>
	`;

	// Scalar-multiplication walk overlay. When a walk is supplied we draw the
	// path G -> 2G -> ... revealed up to `upto` hops: connecting segments plus
	// a numbered marker on each visited point. Only finite points are drawn;
	// a hop that lands on O (rare on this curve for a in [1, n-1]) is skipped
	// visually but still counted in the label.
	let walkOverlay = '';
	if (walk && upto > 0) {
		const revealed = walk.slice(0, upto).filter((p) => !p.infinity);
		const segs = revealed
			.map((pt, i) => {
				if (i === 0) return '';
				const prev = revealed[i - 1]!;
				return `<line class="ec-walk-seg" x1="${sx(prev.x)}" y1="${sy(prev.y)}" x2="${sx(pt.x)}" y2="${sy(pt.y)}" />`;
			})
			.join('');
		const markers = revealed
			.map((pt, i) => {
				const isLast = i === revealed.length - 1;
				return `
					<circle class="ec-walk-node${isLast ? ' ec-walk-node--head' : ''}" cx="${sx(pt.x)}" cy="${sy(pt.y)}" r="10" />
					<text class="ec-walk-num" x="${sx(pt.x)}" y="${sy(pt.y) + 3.5}" text-anchor="middle">${i + 1}</text>
				`;
			})
			.join('');
		walkOverlay = `<g class="ec-walk-layer" aria-hidden="true">${segs}${markers}</g>`;
	}

	return `
		<svg viewBox="0 0 ${W} ${H}" width="100%" role="presentation" focusable="false">
			${axes}
			${dots}
			${walkOverlay}
			${infinityMarker}
		</svg>
		<p class="ec-plot-caption">${points.length} finite points + O. Curve = <code>y² = x³ + ${curve.a}x + ${curve.b} (mod ${curve.p})</code>.</p>
	`;
}


function renderEcdhResult(r: EcdhResult): string {
	const status = r.agree
		? `<span class="scenario-status--valid">✓ a·B = b·A</span>`
		: `<span class="scenario-status--invalid">✗ Disagree</span>`;
	return `
		<div class="kx-grid">
			<div class="kx-side">
				<p class="hero-metric-label">Alice</p>
				<p class="mono-inline">A = a·G = ${r.a}·G = <strong>${pointToString(r.A)}</strong></p>
				<p class="mono-inline">shared = a·B = ${r.a}·${pointToString(r.B)} = <strong>${pointToString(r.sharedFromAlice)}</strong></p>
			</div>
			<div class="kx-side">
				<p class="hero-metric-label">Bob</p>
				<p class="mono-inline">B = b·G = ${r.b}·G = <strong>${pointToString(r.B)}</strong></p>
				<p class="mono-inline">shared = b·A = ${r.b}·${pointToString(r.A)} = <strong>${pointToString(r.sharedFromBob)}</strong></p>
			</div>
		</div>
		<p class="kx-status">${status}</p>
		<p class="kx-footnote">Same DH idea, on a curve. Curve25519 uses the same scalar-mul-on-a-curve mechanic with a 256-bit prime, getting roughly 128 bits of classical security with 32-byte keys.</p>
	`;
}

// ---------- 5. ML-KEM encapsulation (real FIPS 203) --------------------------

interface SharedSecrets {
	dh: number;
	kem: string;
}

function renderKemSection(state: SharedSecrets): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'kem';
	section.setAttribute('aria-labelledby', 'kem-heading');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 5</p>
				<h2 id="kem-heading">The mechanic shift: KEM vs DH</h2>
				<p class="panel-copy">DH and ECDH have <em>both</em> sides exponentiate to a shared value. A KEM has Bob <em>encapsulate</em> a fresh secret to Alice’s public key, and Alice <em>decapsulates</em>. Different shape, same end state.</p>
			</div>
		</div>
		${threatBadges(['passive', 'quantum'], ['active'])}
		<div class="toy-banner" role="note">
			<span class="toy-banner-tag toy-banner-tag--real">Real crypto</span>
			<span class="toy-banner-body">This runs <strong>real ML-KEM-768 (FIPS 203)</strong> from <code>@noble/post-quantum</code> — full Module-LWE, NTT, and compression. Bob encapsulates to Alice’s actual public key; Alice decapsulates the actual ciphertext. Unlike the DH/ECDH panels above, these are production-grade parameters, not toy ones. See § Module-LWE for the underlying hard problem.</span>
		</div>
		<div class="reuse-grid">
			<div class="panel-card">
				<h3>DH / ECDH</h3>
				<p class="panel-copy">Symmetric exponentiation. Alice and Bob each have a secret exponent; both derive the shared value by exponentiating the other’s public output.</p>
			</div>
			<div class="panel-card">
				<h3>ML-KEM (FIPS 203)</h3>
				<p class="panel-copy">Asymmetric encapsulation. Bob generates a fresh secret, encrypts it to Alice’s public key, and ships the ciphertext. Alice decapsulates to recover the same secret.</p>
			</div>
		</div>
		<div class="kx-actions">
			<button id="kem-run" class="tab-button" type="button">Run encapsulation</button>
		</div>
		<div id="kem-output" class="kx-output" aria-live="polite"></div>
	`;

	const btn = section.querySelector<HTMLButtonElement>('#kem-run')!;
	const output = section.querySelector<HTMLElement>('#kem-output')!;

	async function run(): Promise<void> {
		btn.disabled = true;
		btn.setAttribute('aria-busy', 'true');
		output.setAttribute('aria-busy', 'true');
		try {
			const r = await mlkemEncapsulateDemo();
			state.kem = r.aliceSecret;
			output.innerHTML = renderKemResult(r);
			window.dispatchEvent(new CustomEvent('kx-state-changed'));
		} catch (err) {
			output.innerHTML = `<p class="scenario-status--invalid">Encapsulation failed: ${(err as Error).message}</p>`;
		} finally {
			btn.disabled = false;
			btn.removeAttribute('aria-busy');
			output.removeAttribute('aria-busy');
		}
	}

	btn.addEventListener('click', () => {
		void run();
	});

	void run();
	return section;
}

function renderKemResult(r: KemResult): string {
	return `
		<div class="kx-grid">
			<div class="kx-side">
				<p class="hero-metric-label">Bob (encapsulator)</p>
				<p class="mono-inline">encaps to Alice’s public key (${r.publicKeyLen.toLocaleString()} B)</p>
				<p class="mono-inline">secret = <strong>${shortHex(r.bobSecret)}</strong> ${copyChip(r.bobSecret, 'secret')}</p>
				<p class="mono-inline">ciphertext → Alice (${r.ciphertextLen.toLocaleString()} B) = <strong>${shortHex(r.ciphertext)}</strong> ${copyChip(r.ciphertext, 'ciphertext')}</p>
			</div>
			<div class="kx-side">
				<p class="hero-metric-label">Alice (decapsulator)</p>
				<p class="mono-inline">decaps the actual ciphertext</p>
				<p class="mono-inline">recovered secret = <strong>${shortHex(r.aliceSecret)}</strong> ${copyChip(r.aliceSecret, 'secret')}</p>
				<p class="mono-inline mono-status ${r.agree ? 'mono-status--ok' : 'mono-status--bad'}">secrets agree: ${r.agree ? '✓' : '✗'}</p>
			</div>
		</div>
		<div class="kx-side kem-tamper">
			<p class="hero-metric-label">Forge check — flip one ciphertext bit</p>
			<p class="mono-inline">Alice decapsulates the tampered ciphertext to a <em>different</em> secret: <strong>${shortHex(r.tamperedSecret)}</strong></p>
			<p class="mono-inline mono-status ${r.tamperRejected ? 'mono-status--ok' : 'mono-status--bad'}">${r.tamperRejected ? '✓ Implicit rejection (FIPS 203): a forged ciphertext never yields Bob’s secret' : '✗ Tampered ciphertext produced Bob’s secret — this should not happen'}</p>
		</div>
		<p class="kx-footnote">${r.note}</p>
	`;
}

function shortHex(hex: string): string {
	if (hex.length <= 32) return hex;
	return `${hex.slice(0, 16)}…${hex.slice(-8)}`;
}

// ---------- 6. Hybrid combine ------------------------------------------------

function renderHybridSection(state: SharedSecrets, getDh: () => number): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'hybrid';
	section.setAttribute('aria-labelledby', 'hybrid-heading');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 6</p>
				<h2 id="hybrid-heading">Hybrid combine</h2>
				<p class="panel-copy">Take the DH shared secret and the ML-KEM secret, hash them together, and use the result as the session key. The channel survives unless <em>both</em> halves break.</p>
			</div>
		</div>
		${threatBadges(['passive', 'quantum', 'migration'], ['active'])}
		<div class="hybrid-halves" aria-label="Where the two halves come from">
			<div class="hybrid-half hybrid-half--dh">
				<p class="hybrid-half-label">Classical half</p>
				<p class="hybrid-half-src">DH shared secret · from § 2 Diffie–Hellman</p>
				<p class="mono-inline hybrid-half-val" id="hybrid-dh-chip">—</p>
			</div>
			<div class="hybrid-arrow" aria-hidden="true">＋</div>
			<div class="hybrid-half hybrid-half--kem">
				<p class="hybrid-half-label">Post-quantum half</p>
				<p class="hybrid-half-src">ML-KEM-768 secret · from § 5 KEM</p>
				<p class="mono-inline hybrid-half-val" id="hybrid-kem-chip">—</p>
			</div>
			<div class="hybrid-arrow" aria-hidden="true">→</div>
			<div class="hybrid-half hybrid-half--out">
				<p class="hybrid-half-label">HKDF</p>
				<p class="hybrid-half-src">session key · secure if either half holds</p>
				<p class="mono-inline hybrid-half-val" id="hybrid-out-chip">—</p>
			</div>
		</div>
		<div class="kx-actions">
			<button id="hybrid-run" class="tab-button" type="button">Combine DH + KEM</button>
		</div>
		<div id="hybrid-output" class="kx-output" aria-live="polite"></div>
		<details class="why-details hybrid-security">
			<summary>Why is the combined key "secure if either half holds"?</summary>
			<p>
				The exact argument depends on the chosen KDF. In the production TLS 1.3
				hybrid draft (Stebila / Fluhrer / Gueron), the session key is
				<code>HKDF-Extract(salt, x25519_secret ‖ mlkem_secret)</code>. Two standard
				properties feed into the security claim:
			</p>
			<ol>
				<li><strong>The KDF is a dual-PRF / random oracle.</strong> An adversary
				who knows only one of the two inputs learns nothing about the output. So
				even if a quantum adversary recovers the X25519 secret via Shor, the
				ML-KEM secret still entropy-extracts to a uniform key. Symmetrically: if
				ML-KEM is later broken, X25519 still does.</li>
				<li><strong>Concatenation order is fixed and authenticated.</strong> The
				ordering, salts, and the rest of the transcript are bound in via the
				TLS handshake hash, so an attacker can't trick one side into using a
				different ordering or omitting a half.</li>
			</ol>
			<p>
				Formal statement: the combined KEM is IND-CCA2-secure under a standard
				model of the KDF as long as <em>at least one</em> of (X25519 DDH,
				Module-LWE) holds. This is exactly the "belt and braces" guarantee — and
				the reason production deployments are willing to pay the ~1.2 KB extra
				per handshake.
			</p>
		</details>
	`;

	const btn = section.querySelector<HTMLButtonElement>('#hybrid-run')!;
	const output = section.querySelector<HTMLElement>('#hybrid-output')!;
	const dhChip = section.querySelector<HTMLElement>('#hybrid-dh-chip')!;
	const kemChip = section.querySelector<HTMLElement>('#hybrid-kem-chip')!;
	const outChip = section.querySelector<HTMLElement>('#hybrid-out-chip')!;

	async function run(): Promise<void> {
		btn.disabled = true;
		btn.setAttribute('aria-busy', 'true');
		output.setAttribute('aria-busy', 'true');
		try {
			const dh = getDh();
			const kem = state.kem;
			// Keep the provenance chips live so it is obvious the two inputs are
			// pulled from other sections — and which one is still missing.
			dhChip.textContent = String(dh);
			dhChip.classList.add('hybrid-half-val--set');
			if (!kem) {
				kemChip.textContent = 'not yet run';
				kemChip.classList.remove('hybrid-half-val--set');
				outChip.textContent = 'waiting for KEM half';
				outChip.classList.remove('hybrid-half-val--set');
				output.innerHTML = `<p class="scenario-status--pending">The classical half (dh = ${dh}) is ready from § 2. The post-quantum half is missing — <a href="#kem" class="hybrid-jump-link">run the KEM section</a> and this combine auto-fires the moment it exists.</p>`;
				return;
			}
			kemChip.textContent = shortHex(kem);
			kemChip.classList.add('hybrid-half-val--set');
			const session = await hybridCombine(dh, kem);
			outChip.textContent = shortHex(session);
			outChip.classList.add('hybrid-half-val--set');
			output.innerHTML = `
				<div class="kx-side">
					<p class="hero-metric-label">Inputs</p>
					<p class="mono-inline">dh = ${dh}</p>
					<p class="mono-inline">kem = ${shortHex(kem)}</p>
				</div>
				<div class="kx-side">
					<p class="hero-metric-label">Session key = HKDF-SHA256(dh<sub>4B</sub> ‖ kem, info = label)</p>
					<p class="mono-inline">${session} ${copyChip(session, 'session key')}</p>
				</div>
				<p class="kx-footnote">The DH value is fixed-width encoded (4-byte big-endian) and mixed with the real ML-KEM-768 secret through HKDF-Extract-then-Expand with a fixed domain-separation label — the same <em>shape</em> as the production X25519MLKEM768 combiner. This is the bridge protocol in production today — X25519MLKEM768 in TLS 1.3, Apple iMessage PQ3, AWS KMS. Secure if either half holds.</p>
			`;
		} catch (err) {
			output.innerHTML = `<p class="scenario-status--invalid">Combine failed: ${(err as Error).message}</p>`;
		} finally {
			btn.disabled = false;
			btn.removeAttribute('aria-busy');
			output.removeAttribute('aria-busy');
		}
	}

	btn.addEventListener('click', () => {
		void run();
	});

	// Auto-run whenever either half changes: the KEM section fires this after
	// encapsulating, and the DH playground fires it when its inputs change.
	window.addEventListener('kx-state-changed', () => {
		void run();
	});

	// Initial paint so the classical-half chip shows the current DH value and
	// the pending banner explains what is still needed — no dead "—" state.
	void run();

	return section;
}

// ---------- Production decision card ----------------------------------------

// The "if I'm building today, what should I use?" answer. Placed
// up-front so engineers and architects can find it without scrolling
// through the teaching content first.
function renderDecisionCard(): HTMLElement {
	const card = el('section', 'lab-section decision-card');
	card.id = 'decision';
	card.setAttribute('aria-labelledby', 'decision-heading');
	// The decision card + its engineer-facing vocabulary (NIST categories,
	// parameter sets) is deferred behind a disclosure so a newcomer meeting
	// key exchange for the first time lands on arithmetic, not on a
	// "what should I ship" briefing. Engineers expand it; beginners scroll past.
	card.innerHTML = `
		<details class="decision-details">
			<summary class="decision-summary">
				<span class="section-kicker">For engineers · optional</span>
				<span class="decision-summary-title" id="decision-heading">Production decision card — what to ship today</span>
				<span class="decision-summary-hint">If you just want to learn how key exchange works, skip this and start with the DH playground below.</span>
			</summary>
		<div class="decision-grid">
			<div class="decision-row">
				<p class="hero-metric-label">Classical-only environment</p>
				<p class="panel-copy"><strong>Use X25519.</strong> Default in TLS 1.3, libsodium, modern SSH. Constant-time, 32-byte keys, no parameter selection.</p>
			</div>
			<div class="decision-row">
				<p class="hero-metric-label">Need post-quantum confidentiality</p>
				<p class="panel-copy"><strong>Use ML-KEM (FIPS 203).</strong> The first standardised post-quantum KEM. ML-KEM-768 is the common middle-ground parameter set (NIST Cat 3).</p>
			</div>
			<div class="decision-row">
				<p class="hero-metric-label">Migrating today</p>
				<p class="panel-copy"><strong>Use hybrid X25519+ML-KEM-768.</strong> What Cloudflare, Chrome, Apple, Signal, and AWS ship today. Secure if either half holds.</p>
			</div>
			<div class="decision-row decision-row--warn">
				<p class="hero-metric-label">In every case</p>
				<p class="panel-copy"><strong>Use a vetted library.</strong> BoringSSL, OpenSSL, libsodium, liboqs, BouncyCastle, RustCrypto. Never roll your own — this lab is for teaching, not deployment.</p>
			</div>
		</div>
		</details>
	`;
	return card;
}

// A one-line on-ramp for someone meeting key exchange for the first time.
// Points straight at the DH playground (§2) so the first thing a newcomer
// touches is live arithmetic, not naming or a shipping decision.
function renderBeginnerBanner(): HTMLElement {
	const banner = el('aside', 'beginner-banner');
	banner.setAttribute('aria-label', 'New here?');
	banner.innerHTML = `
		<span class="beginner-banner-tag">New here?</span>
		<p class="beginner-banner-text">
			Key exchange is how two people agree on a shared secret while a stranger watches every message.
			Start with the hands-on math — <a href="#dh" class="beginner-banner-link">jump to the Diffie–Hellman playground</a> — then follow the five generations up to post-quantum. The naming and production advice can wait.
		</p>
	`;
	return banner;
}

// ---------- Synthesis card --------------------------------------------------

// "If you remember only three things." Placed just before References so
// the page has a clean closing summary that survives skimming.
function renderSynthesis(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'synthesis';
	section.setAttribute('aria-labelledby', 'synthesis-heading');
	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Closing</p>
				<h2 id="synthesis-heading">If you remember three things</h2>
			</div>
		</div>
		<ol class="synthesis-list">
			<li>
				<h3>DH, ECDH, and X25519 are the same idea in stronger groups.</h3>
				<p class="panel-copy">All three rely on the discrete-log problem. Each move bought shorter keys, faster handshakes, or cleaner engineering — never a different security story. Shor’s algorithm breaks all three.</p>
			</li>
			<li>
				<h3>ML-KEM is a genuinely different mechanism.</h3>
				<p class="panel-copy">A Key Encapsulation Mechanism over polynomial rings, secured by Module-LWE. Shor doesn’t touch it — its hardness rests on lattice problems, not on hidden periodic structure.</p>
			</li>
			<li>
				<h3>Hybrid is the migration bridge, not a destination.</h3>
				<p class="panel-copy">X25519MLKEM768 in TLS 1.3 is what production ships today. Secure if either half holds; once we are confident in ML-KEM and the quantum threat is acute, the classical half may be retired.</p>
			</li>
		</ol>
	`;
	return section;
}

// ---------- Side-by-side comparison (all 5 generations at once) -------------

// The five generations have their own tablist (§ 1) — but for compare-
// across questions you really want one screen with everything visible.
// This is that screen.
function renderCompare(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'compare';
	section.setAttribute('aria-labelledby', 'compare-heading');

	const rows = [
		{ field: 'Year', get: (g: Generation) => String(g.year) },
		{ field: 'Mechanism', get: (g: Generation) => g.mechanic },
		{ field: 'Hard problem', get: (g: Generation) => g.hardProblem },
		{ field: 'Typical key size', get: (g: Generation) => g.keySize },
		{
			field: 'Post-quantum?',
			get: (g: Generation) =>
				g.pqSafe
					? '<span class="gen-pill-chip chip-safe">PQ-safe</span>'
					: '<span class="gen-pill-chip chip-broken">Broken by Shor</span>',
		},
	];

	const header = `<tr><th scope="col">&nbsp;</th>${GENERATIONS.map(
		(g) => `<th scope="col">${g.name}<br><span class="compare-year">${g.year}</span></th>`,
	).join('')}</tr>`;

	const body = rows
		.map(
			(r) =>
				`<tr><th scope="row">${r.field}</th>${GENERATIONS.map((g) => `<td>${r.get(g)}</td>`).join('')}</tr>`,
		)
		.join('');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Compare across</p>
				<h2 id="compare-heading">All five at once</h2>
				<p class="panel-copy">The five-generation tablist lets you drill into one; this table puts every generation on the same screen so the contrast — mechanism, hard problem, size, quantum status — is unmissable.</p>
			</div>
		</div>
		<div class="table-shell" tabindex="0" role="region" aria-label="All five generations compared">
			<table class="math-table compare-table">
				<thead>${header}</thead>
				<tbody>${body}</tbody>
			</table>
		</div>
	`;
	return section;
}

// ---------- 7. Sizes comparison ----------------------------------------------

function renderSizes(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'sizes';
	section.setAttribute('aria-labelledby', 'sizes-heading');

	const max = Math.max(...SIZES.map((s) => s.bytes));
	const rows = SIZES.map((s) => {
		const pct = Math.max(2, (s.bytes / max) * 100);
		return `
			<li class="size-row">
				<div class="size-label"><strong>${s.label}</strong> <span class="size-bytes">${s.bytes.toLocaleString()} B</span></div>
				<div class="size-bar-track"><div class="size-bar-fill size-bar-fill--${s.id}" style="width: ${pct.toFixed(1)}%"></div></div>
				<p class="size-note">${s.note}</p>
			</li>
		`;
	}).join('');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 7</p>
				<h2 id="sizes-heading">Sizes across generations</h2>
				<p class="panel-copy">Public-key sizes at the parameter sets each generation is actually deployed at. The post-quantum move multiplies the public key by about 37× over X25519 — which is exactly why production deployments hedge with hybrid rather than just dropping ML-KEM in alone.</p>
			</div>
		</div>
		<ul class="size-list" aria-label="Public-key byte sizes per generation">${rows}</ul>
	`;
	return section;
}

// ---------- 8. History timeline ----------------------------------------------

function renderHistory(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'history';
	section.setAttribute('aria-labelledby', 'history-heading');

	const items = HISTORY.map(
		(h) => `
		<li class="hist-item hist-item--${h.kind}">
			<div class="hist-year">${h.year}</div>
			<div class="hist-body">
				<p class="hist-kind">${h.kind}</p>
				<h3>${h.title}</h3>
				<p class="panel-copy">${h.body}</p>
			</div>
		</li>
	`,
	).join('');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 8</p>
				<h2 id="history-heading">A dated history</h2>
				<p class="panel-copy">Every entry below is something you can look up — paper, attack, RFC, FIPS standard.</p>
			</div>
		</div>
		<ol class="hist-list">${items}</ol>
	`;
	return section;
}

// ---------- 9. Production deployments ---------------------------------------

function renderDeployments(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'production';
	section.setAttribute('aria-labelledby', 'production-heading');

	const cards = DEPLOYMENTS.map(
		(d) => `
		<article class="panel-card">
			<p class="hero-metric-label">${d.year}</p>
			<h3>${d.name}</h3>
			<p class="panel-copy">${d.what}</p>
			<p class="panel-copy"><a class="deployment-link" href="${d.url}" target="_blank" rel="noopener noreferrer">Source ↗</a></p>
		</article>
	`,
	).join('');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 9</p>
				<h2 id="production-heading">Production today</h2>
				<p class="panel-copy">Where hybrid X25519+ML-KEM is actually running, with sources you can verify.</p>
			</div>
		</div>
		<div class="reuse-grid">${cards}</div>
	`;
	return section;
}

// ---------- 10. Shor's algorithm ---------------------------------------------

// Classical implementation of Shor's order-finding subroutine.  The
// quantum part of Shor — finding the period of f(x) = a^x mod N — is
// what a fault-tolerant quantum computer does in polynomial time.
// Here we compute the period by brute force (feasible because N is tiny)
// and then run the same classical post-processing Shor would: take
// gcd(a^(r/2) ± 1, N) to recover non-trivial factors of N.
function shorClassical(N: number, a: number): {
	cycle: number[];
	period: number;
	successful: boolean;
	failureReason?: string;
	factors?: [number, number];
	half?: number;
} {
	if (gcdInt(a, N) !== 1) {
		return { cycle: [], period: 0, successful: false, failureReason: `gcd(${a}, ${N}) = ${gcdInt(a, N)} — already a factor, no Shor needed.` };
	}
	const cycle: number[] = [];
	let cur = 1;
	for (let i = 1; i <= N; i++) {
		cur = (cur * a) % N;
		cycle.push(cur);
		if (cur === 1) {
			const r = i;
			if (r % 2 !== 0) {
				return { cycle, period: r, successful: false, failureReason: `Period ${r} is odd — Shor retries with a different a.` };
			}
			const half = modPow(a, r / 2, N);
			if (half === N - 1) {
				return { cycle, period: r, successful: false, failureReason: `a^(r/2) = N − 1 — trivial case, Shor retries with a different a.`, half };
			}
			const f1 = gcdInt(half - 1, N);
			const f2 = gcdInt(half + 1, N);
			if (f1 > 1 && f1 < N && f2 > 1 && f2 < N && f1 * f2 === N) {
				return { cycle, period: r, half, successful: true, factors: [f1, f2] };
			}
			return { cycle, period: r, half, successful: false, failureReason: `Recovered gcds (${f1}, ${f2}) are not a clean factorisation — try a different a.` };
		}
	}
	return { cycle, period: 0, successful: false, failureReason: 'No period found within N — pick a smaller N or different a.' };
}

function gcdInt(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		[x, y] = [y, x % y];
	}
	return x;
}

const SHOR_TARGETS = [15, 21, 33, 35, 39, 51, 55, 77, 85, 91];

function renderShor(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'shor';
	section.setAttribute('aria-labelledby', 'shor-heading');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 10</p>
				<h2 id="shor-heading">Shor's algorithm — the threat</h2>
				<p class="panel-copy">DH, ECDH, and X25519 all hide a secret as an exponent. Shor's algorithm (1994) finds that exponent in polynomial time on a fault-tolerant quantum computer — by reducing it to <em>period-finding</em>, a problem the quantum Fourier transform solves efficiently. Here is the classical post-processing on small numbers, so you can see what Shor would do <em>after</em> the quantum part.</p>
			</div>
		</div>
		<div class="kx-inputs" role="group" aria-label="Shor inputs">
			<label>
				<span>Composite <code>N</code> to factor</span>
				<select id="shor-N">
					${SHOR_TARGETS.map((n) => `<option value="${n}"${n === 15 ? ' selected' : ''}>${n}</option>`).join('')}
				</select>
			</label>
			<label>
				<span>Random base <code>a</code> (coprime to N)</span>
				<input type="number" id="shor-a" min="2" value="2" />
			</label>
			<label class="kx-spans-both">
				<button id="shor-random-a" class="tab-button" type="button">Pick a new random a</button>
			</label>
		</div>
		<div id="shor-output" class="kx-output" aria-live="polite"></div>
		<div id="shor-viz" class="shor-viz-wrap"></div>
		<div class="panel-card shor-context">
			<h3>What the quantum part actually does</h3>
			<p class="panel-copy">
				A classical computer can find the period <code>r</code> for tiny <code>N</code> by iterating <code>a, a², a³ …</code> until it sees 1 again — that's what you just did above. A quantum computer prepares a superposition over all <code>x</code>, applies <code>f(x) = aˣ mod N</code>, then quantum-Fourier-transforms the output register. Measuring gives a sample of the Fourier spectrum of <code>f</code>, which is sharply peaked at multiples of <code>1/r</code> — continued fractions on that sample recovers <code>r</code> in polynomial time. The same trick recovers the exponent in DH/ECDH/X25519 by finding the period of a closely-related function.
			</p>
			<p class="panel-copy">
				<strong>Why Module-LWE survives.</strong> Shor's speed-up needs a hidden <em>periodic</em> structure. Lattice problems like Module-LWE don't have one — the secret is a short vector, not a hidden exponent, and the noise <code>e</code> destroys whatever Fourier structure a noise-free instance might have. No quantum algorithm is known to beat the best classical lattice algorithms by more than a Grover-style square-root factor.
			</p>
			<h3>Resource estimate (Gidney &amp; Ekerå, 2019)</h3>
			<div class="table-shell" tabindex="0" role="region" aria-label="Quantum resource estimate to break RSA-2048 by Shor's algorithm">
				<table class="math-table shor-resources">
					<thead><tr><th>Target</th><th>Logical qubits</th><th>Physical qubits</th><th>Wall time</th></tr></thead>
					<tbody>
						<tr><td>RSA-2048</td><td class="mono-cell">≈ 4 100</td><td class="mono-cell">≈ 20 000 000</td><td class="mono-cell">≈ 8 hours</td></tr>
						<tr><td>2048-bit DH</td><td class="mono-cell">≈ 4 100</td><td class="mono-cell">≈ 20 000 000</td><td class="mono-cell">≈ 8 hours</td></tr>
						<tr><td>Curve25519 (ECDLP)</td><td class="mono-cell">≈ 2 330</td><td class="mono-cell">≈ 11 000 000</td><td class="mono-cell">≈ hours</td></tr>
					</tbody>
				</table>
			</div>
			<p class="kx-footnote">Today's best superconducting hardware is on the order of 1 000 noisy physical qubits. The gap is huge — but the curve of progress and the long lifetime of harvested traffic are exactly why production has already started migrating.</p>
		</div>
	`;

	const nSel = section.querySelector<HTMLSelectElement>('#shor-N')!;
	const aInput = section.querySelector<HTMLInputElement>('#shor-a')!;
	const randomBtn = section.querySelector<HTMLButtonElement>('#shor-random-a')!;
	const output = section.querySelector<HTMLElement>('#shor-output')!;
	const viz = section.querySelector<HTMLElement>('#shor-viz')!;

	function rerun(): void {
		const N = parseInt(nSel.value, 10);
		let a = clampInt(aInput.value, 2, N - 1, 2);
		const r = shorClassical(N, a);
		output.innerHTML = renderShorResult(N, a, r);
		viz.innerHTML = renderShorPeriodViz(N, a, r.period);
	}

	function pickRandomA(): void {
		const N = parseInt(nSel.value, 10);
		// Pick a coprime to N for a clean run.
		for (let attempt = 0; attempt < 100; attempt++) {
			const candidate = 2 + Math.floor(Math.random() * (N - 3));
			if (gcdInt(candidate, N) === 1) {
				aInput.value = String(candidate);
				rerun();
				return;
			}
		}
	}

	nSel.addEventListener('change', rerun);
	aInput.addEventListener('input', rerun);
	randomBtn.addEventListener('click', pickRandomA);

	rerun();
	return section;
}

function renderShorResult(
	N: number,
	a: number,
	r: ReturnType<typeof shorClassical>,
): string {
	const cycleHtml = r.cycle.length
		? r.cycle
				.map(
					(v, i) =>
						`<span class="shor-cycle-step${v === 1 && i === r.cycle.length - 1 ? ' shor-cycle-step--end' : ''}">${a}<sup>${i + 1}</sup> = ${v}</span>`,
				)
				.join('<span class="shor-cycle-arrow">→</span>')
		: '';
	if (!r.successful) {
		return `
			<div class="kx-side">
				<p class="hero-metric-label">Trying ${a}ˣ mod ${N}</p>
				<p class="mono-inline shor-cycle">${cycleHtml || '(no cycle)'}</p>
				${r.period ? `<p class="mono-inline">Period r = <strong>${r.period}</strong></p>` : ''}
				${r.half !== undefined ? `<p class="mono-inline">a<sup>r/2</sup> mod N = ${r.half}</p>` : ''}
				<p class="scenario-status--invalid">✗ ${r.failureReason}</p>
				<p class="kx-footnote">Shor's algorithm allows for some retries — about a constant fraction of choices of <code>a</code> yield a clean factorisation.</p>
			</div>
		`;
	}
	const [f1, f2] = r.factors!;
	return `
		<div class="kx-side">
			<p class="hero-metric-label">Trying ${a}ˣ mod ${N}</p>
			<p class="mono-inline shor-cycle">${cycleHtml}</p>
			<p class="mono-inline">Period r = <strong>${r.period}</strong> (even ✓)</p>
			<p class="mono-inline">a<sup>r/2</sup> mod N = ${a}<sup>${r.period / 2}</sup> mod ${N} = <strong>${r.half}</strong></p>
			<p class="mono-inline">gcd(${r.half} − 1, ${N}) = <strong>${f1}</strong></p>
			<p class="mono-inline">gcd(${r.half} + 1, ${N}) = <strong>${f2}</strong></p>
			<p class="scenario-status--valid">✓ ${N} = ${f1} × ${f2}</p>
		</div>
	`;
}

// "Shor in three registers": the step the quantum computer actually does.
// We plot the REAL function f(x) = a^x mod N (register 2, the periodic one)
// and the REAL magnitude of its Discrete Fourier Transform over a window
// (register 3, what the QFT produces). The DFT of a periodic sequence peaks
// at multiples of window/r — those peaks are exactly what continued fractions
// turn into r. Nothing here is faked: the bars are the true modular powers and
// the spectrum is a true |DFT|. It is labelled as the classical stand-in for
// the quantum step so no one mistakes iteration for the quantum advantage.
function renderShorPeriodViz(N: number, a: number, period: number): string {
	if (gcdInt(a, N) !== 1 || period <= 0) {
		return `<p class="shor-viz-note">Pick an <code>a</code> coprime to ${N} with an even period to see the periodic structure the quantum Fourier transform exploits.</p>`;
	}
	// Register 2: the periodic function itself.
	const cols = Math.min(48, Math.max(period * 3, 16));
	const fvals: number[] = [];
	let cur = 1;
	for (let x = 0; x < cols; x++) {
		fvals.push(cur);
		cur = (cur * a) % N;
	}

	// Register 3: real |DFT| of f over the window. We report the magnitude at
	// each frequency bin; a period-r signal concentrates energy at bins that
	// are multiples of cols/r. We compute it honestly with the naive O(n^2) DFT
	// (cols is tiny). Bin 0 (the DC term) is dropped from the display since it
	// only reflects the mean and would dwarf the informative peaks.
	const mags: number[] = [];
	for (let k = 0; k < cols; k++) {
		let re = 0;
		let im = 0;
		for (let x = 0; x < cols; x++) {
			const ang = (-2 * Math.PI * k * x) / cols;
			re += fvals[x]! * Math.cos(ang);
			im += fvals[x]! * Math.sin(ang);
		}
		mags.push(Math.hypot(re, im));
	}
	const specVals = mags.slice(1); // drop DC bin
	const maxF = Math.max(...fvals, 1);
	const maxS = Math.max(...specVals, 1);

	// SVG geometry.
	const W = 640;
	const rowH = 120;
	const pad = 30;
	const barW = (W - 2 * pad) / cols;

	const fBars = fvals
		.map((v, x) => {
			const h = (v / maxF) * (rowH - 24);
			const inFirstPeriod = x < period;
			return `<rect class="shor-bar${inFirstPeriod ? ' shor-bar--period' : ''}" x="${pad + x * barW + 1}" y="${rowH - 4 - h}" width="${Math.max(1, barW - 2)}" height="${h}"><title>x=${x}: ${a}^${x} mod ${N} = ${v}</title></rect>`;
		})
		.join('');

	// Mark the first full period span under register 2.
	const periodBracket = `
		<line class="shor-period-rule" x1="${pad}" y1="${rowH - 2}" x2="${pad + period * barW}" y2="${rowH - 2}" />
		<text class="shor-viz-tick" x="${pad + (period * barW) / 2}" y="${rowH + 12}" text-anchor="middle">period r = ${period}</text>
	`;

	const sBars = specVals
		.map((v, i) => {
			const k = i + 1;
			const h = (v / maxS) * (rowH - 24);
			// A bin is a "peak" if it is close to a multiple of cols/r.
			const nearestMultiple = Math.round((k * period) / cols) * (cols / period);
			const isPeak = Math.abs(k - nearestMultiple) < 0.5 && v > 0.35 * maxS;
			return `<rect class="shor-bar shor-bar--spec${isPeak ? ' shor-bar--peak' : ''}" x="${pad + i * barW + 1}" y="${rowH - 4 - h}" width="${Math.max(1, barW - 2)}" height="${h}"><title>frequency bin ${k}: |DFT| = ${v.toFixed(1)}</title></rect>`;
		})
		.join('');

	return `
		<div class="panel-card shor-viz-card">
			<div class="shor-viz-head">
				<h3>Shor in three registers</h3>
				<span class="shor-viz-badge">this is the step the quantum computer does</span>
			</div>
			<p class="panel-copy shor-viz-lede">
				A quantum computer holds all inputs <code>x</code> at once (register 1), computes
				<code>f(x) = ${a}ˣ mod ${N}</code> into register 2, then Fourier-transforms register 3.
				The plots below are the <em>real</em> function values and the <em>real</em> |DFT| of that
				window — the classical stand-in for what the QFT produces in one shot.
			</p>
			<figure class="shor-viz-figure">
				<figcaption class="shor-viz-cap">Register 2 — <code>f(x) = ${a}ˣ mod ${N}</code> repeats every <strong>r = ${period}</strong> steps</figcaption>
				<svg viewBox="0 0 ${W} ${rowH + 20}" width="100%" role="img" aria-label="Bar plot of a to the x mod N, showing it repeats every ${period} steps">
					${fBars}
					${periodBracket}
				</svg>
			</figure>
			<figure class="shor-viz-figure">
				<figcaption class="shor-viz-cap">Register 3 — |DFT| of that window peaks at multiples of <code>window / r</code>; continued fractions on a peak gives back <strong>r</strong></figcaption>
				<svg viewBox="0 0 ${W} ${rowH + 8}" width="100%" role="img" aria-label="Fourier spectrum with sharp peaks at multiples of the window size over the period">
					${sBars}
				</svg>
			</figure>
			<p class="kx-footnote shor-viz-foot">
				The cycle you iterated above is the <strong>classical</strong> way to find <code>r</code>; it is linear in <code>N</code>. The quantum win is that the QFT surfaces those peaks in <em>one</em> query regardless of <code>N</code>'s size. Module-LWE has no such hidden period for the transform to expose — which is the whole reason it survives Shor.
			</p>
		</div>
	`;
}

// ---------- 11. Module-LWE ---------------------------------------------------

// Tiny instance of the Module-LWE hard problem. With q = 11, n = 3, k = 3
// the secret s and error e are short vectors, A is a public 3×3 matrix
// over Z_q, and b = A·s + e mod q is published. Recovering s given (A, b)
// is the (decisional) Module-LWE problem — believed hard for both
// classical and quantum adversaries even at much larger parameters.
function renderModuleLwe(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'mlwe';
	section.setAttribute('aria-labelledby', 'mlwe-heading');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 11</p>
				<h2 id="mlwe-heading">Module-LWE — the new hard problem</h2>
				<p class="panel-copy">ML-KEM's security rests on a single conjecture: <em>given (A, b = A·s + e mod q) with A public, s and e short and secret, recovering s is hard</em>. Here it is at toy size so you can see the shape — and try to break it yourself. Click "Resample" for fresh values, then flip the noise on and off and hit "Solve for s".</p>
			</div>
		</div>
		${toyBanner('q = 11, n = k = 3 so a 3×3 solve fits on screen. Real ML-KEM uses n = 256, k ∈ {2, 3, 4} over a polynomial ring — the same shape, far out of reach of any known solver.')}
		<div class="kx-inputs mlwe-controls" role="group" aria-label="Module-LWE controls">
			<label class="mlwe-toggle">
				<input type="checkbox" id="mlwe-noise" checked />
				<span>Add noise <code>e</code> (this is what ML-KEM does)</span>
			</label>
		</div>
		<div class="kx-actions">
			<button id="mlwe-resample" class="tab-button" type="button">Resample A, s, e</button>
			<button id="mlwe-solve" class="tab-button" type="button">Solve A·s = b for s (Gaussian elimination)</button>
		</div>
		<div id="mlwe-output" class="kx-output" aria-live="polite"></div>
		<div id="mlwe-attack" class="kx-output" aria-live="polite"></div>
		<div class="panel-card">
			<h3>Why this is hard</h3>
			<p class="panel-copy">
				Without the noise <code>e</code>, the system <code>A·s = b mod q</code> is a linear-algebra problem and Gaussian elimination solves it in milliseconds — try it above with noise off and it recovers <code>s</code> exactly. Turn the noise on and the <em>same</em> elimination runs to completion but lands on a <em>wrong, non-short</em> vector: the equations are "almost satisfied" by many candidates, and finding the short one the encrypter chose reduces to lattice problems (shortest-vector, learning-with-errors) for which no efficient classical or quantum algorithm is known. ML-KEM picks <code>n = 256</code>, <code>k ∈ {2, 3, 4}</code>, and a carefully shaped distribution for <code>s</code> and <code>e</code> to land at Categories 1, 3, and 5 of NIST's PQC security floor.
			</p>
		</div>
	`;

	const output = section.querySelector<HTMLElement>('#mlwe-output')!;
	const attackOut = section.querySelector<HTMLElement>('#mlwe-attack')!;
	const resampleBtn = section.querySelector<HTMLButtonElement>('#mlwe-resample')!;
	const solveBtn = section.querySelector<HTMLButtonElement>('#mlwe-solve')!;
	const noiseToggle = section.querySelector<HTMLInputElement>('#mlwe-noise')!;

	let instance = sampleModuleLwe();

	function render(): void {
		const useNoise = noiseToggle.checked;
		output.innerHTML = renderModuleLweInstance(instance, useNoise);
		attackOut.innerHTML = '';
	}
	function resample(): void {
		instance = sampleModuleLwe();
		render();
	}
	function solve(): void {
		const useNoise = noiseToggle.checked;
		attackOut.innerHTML = renderModuleLweSolve(instance, useNoise);
	}

	resampleBtn.addEventListener('click', resample);
	solveBtn.addEventListener('click', solve);
	noiseToggle.addEventListener('change', render);
	render();
	return section;
}

interface MlweInstance {
	q: number;
	n: number;
	k: number;
	A: number[][];
	s: number[];
	e: number[];
	bNoisy: number[]; // A·s + e mod q
	bClean: number[]; // A·s      mod q
}

function mlweMod(x: number, q: number): number {
	return ((x % q) + q) % q;
}

// Sample a Module-LWE instance whose public matrix A is INVERTIBLE mod q, so
// Gaussian elimination has a unique solution. That is the honest setup: with
// no noise the unique solution IS s; with noise the unique solution is some
// other, non-short vector. (Real ML-KEM uses a wide, non-square structure; the
// square invertible case is the cleanest way to show the noise-free system is
// trivially solvable.)
function sampleModuleLwe(): MlweInstance {
	const q = 11;
	const n = 3;
	const k = 3;
	for (let attempt = 0; attempt < 200; attempt++) {
		const A: number[][] = Array.from({ length: k }, () =>
			Array.from({ length: n }, () => Math.floor(Math.random() * q)),
		);
		if (matDetInvertible(A, q)) {
			const s = Array.from({ length: n }, () => Math.floor(Math.random() * 3) - 1);
			const e = Array.from({ length: k }, () => Math.floor(Math.random() * 3) - 1);
			const bClean = A.map((row) =>
				mlweMod(row.reduce((acc, aij, j) => acc + aij * s[j]!, 0), q),
			);
			const bNoisy = bClean.map((v, i) => mlweMod(v + e[i]!, q));
			return { q, n, k, A, s, e, bNoisy, bClean };
		}
	}
	// Fallback: identity A (always invertible) — keeps the demo deterministic
	// even in the astronomically unlikely case above never hits.
	const A = [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	];
	const s = [1, -1, 0];
	const e = [0, 1, -1];
	const bClean = A.map((row) => mlweMod(row.reduce((acc, aij, j) => acc + aij * s[j]!, 0), q));
	const bNoisy = bClean.map((v, i) => mlweMod(v + e[i]!, q));
	return { q, n, k, A, s, e, bNoisy, bClean };
}

// Is det(A) a unit mod q (i.e. gcd(det, q) = 1)? q = 11 is prime, so this is
// just det != 0 mod q, but we keep the general form.
function matDetInvertible(A: number[][], q: number): boolean {
	const n = A.length;
	const M = A.map((r) => r.slice());
	let det = 1;
	for (let col = 0; col < n; col++) {
		let piv = -1;
		for (let r = col; r < n; r++) {
			if (mlweMod(M[r]![col]!, q) !== 0) {
				piv = r;
				break;
			}
		}
		if (piv === -1) return false;
		if (piv !== col) {
			[M[col], M[piv]] = [M[piv]!, M[col]!];
			det = mlweMod(-det, q);
		}
		det = mlweMod(det * M[col]![col]!, q);
		const inv = modInverseSmall(M[col]![col]!, q);
		for (let r = col + 1; r < n; r++) {
			const factor = mlweMod(M[r]![col]! * inv, q);
			for (let c = col; c < n; c++) {
				M[r]![c] = mlweMod(M[r]![c]! - factor * M[col]![c]!, q);
			}
		}
	}
	return mlweMod(det, q) !== 0;
}

// Modular inverse of a small value mod prime q by brute search (q ≤ 11 here).
function modInverseSmall(a: number, q: number): number {
	const am = mlweMod(a, q);
	for (let x = 1; x < q; x++) {
		if (mlweMod(am * x, q) === 1) return x;
	}
	throw new Error(`no inverse of ${a} mod ${q}`);
}

// Solve A·x = b mod q by Gaussian elimination (q prime). Returns the unique
// solution vector x. Real code, no shortcuts — this is the exact classical
// attack, and its whole point is that it succeeds on the noise-free b and
// fails (recovers a wrong vector) on the noisy b.
function gaussSolveModQ(A: number[][], b: number[], q: number): number[] {
	const n = A.length;
	const M = A.map((r, i) => [...r, b[i]!]);
	for (let col = 0; col < n; col++) {
		let piv = -1;
		for (let r = col; r < n; r++) {
			if (mlweMod(M[r]![col]!, q) !== 0) {
				piv = r;
				break;
			}
		}
		if (piv === -1) throw new Error('singular');
		[M[col], M[piv]] = [M[piv]!, M[col]!];
		const inv = modInverseSmall(M[col]![col]!, q);
		for (let c = col; c <= n; c++) M[col]![c] = mlweMod(M[col]![c]! * inv, q);
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const factor = mlweMod(M[r]![col]!, q);
			for (let c = col; c <= n; c++) {
				M[r]![c] = mlweMod(M[r]![c]! - factor * M[col]![c]!, q);
			}
		}
	}
	return M.map((row) => mlweMod(row[n]!, q));
}

// Represent a residue in the centered range (−q/2, q/2] so "short" is visible.
function centeredRep(v: number, q: number): number {
	const m = mlweMod(v, q);
	return m > q / 2 ? m - q : m;
}

function fmtSignedLwe(v: number): string {
	return v >= 0 ? `+${v}` : `${v}`;
}

function renderModuleLweInstance(inst: MlweInstance, useNoise: boolean): string {
	const { q, n, k, A, s, e } = inst;
	const b = useNoise ? inst.bNoisy : inst.bClean;

	function matrixHtml(label: string, m: number[][]): string {
		const rows = m
			.map((row) => `<tr>${row.map((v) => `<td class="mono-cell">${v}</td>`).join('')}</tr>`)
			.join('');
		return `
			<div class="mlwe-matrix">
				<p class="hero-metric-label">${label}</p>
				<table class="mlwe-grid" aria-label="${label}"><tbody>${rows}</tbody></table>
			</div>
		`;
	}
	function vectorHtml(label: string, v: number[], signed = false): string {
		const cells = v
			.map((x) => `<td class="mono-cell">${signed ? fmtSignedLwe(x) : x}</td>`)
			.join('');
		return `
			<div class="mlwe-matrix">
				<p class="hero-metric-label">${label}</p>
				<table class="mlwe-grid" aria-label="${label}"><tbody><tr>${cells}</tr></tbody></table>
			</div>
		`;
	}

	const bLabel = useNoise ? `Public b = A·s + e mod ${q}` : `Public b = A·s mod ${q} (noise off)`;
	const eBlock = useNoise
		? vectorHtml('Error e (short)', e, true)
		: `<div class="mlwe-matrix mlwe-matrix--off">
				<p class="hero-metric-label">Error e</p>
				<table class="mlwe-grid" aria-label="Error e disabled"><tbody><tr>${e
					.map(() => `<td class="mono-cell mono-cell--off">0</td>`)
					.join('')}</tr></tbody></table>
			</div>`;

	return `
		<div class="mlwe-grid-row">
			${matrixHtml('Public A (k=' + k + ' × n=' + n + ')', A)}
			${vectorHtml('Secret s (short)', s, true)}
			${eBlock}
			${vectorHtml(bLabel, b)}
		</div>
		<p class="kx-footnote">
			Public: <strong>A</strong>, <strong>b</strong>.  Secret: <strong>s</strong>, <strong>e</strong>.  Modulus q = ${q}.  ${
				useNoise
					? 'Noise is <strong>on</strong> — this is a real (toy-size) Module-LWE instance. Hit "Solve" and watch elimination miss the true s.'
					: 'Noise is <strong>off</strong> — this is a plain linear system. Hit "Solve" and elimination recovers s exactly.'
			}  In ML-KEM the same shape scales up to n = 256 with k ∈ {2, 3, 4} over a polynomial ring.
		</p>
	`;
}

function renderModuleLweSolve(inst: MlweInstance, useNoise: boolean): string {
	const { q, A, s } = inst;
	const b = useNoise ? inst.bNoisy : inst.bClean;
	let solved: number[];
	try {
		solved = gaussSolveModQ(A, b, q);
	} catch {
		return `<p class="scenario-status--invalid">A turned out singular mod ${q} — hit Resample.</p>`;
	}
	// Compare the eliminated solution to the true short secret s.
	const sMod = s.map((v) => mlweMod(v, q));
	const exact = solved.every((v, i) => v === sMod[i]);
	const centered = solved.map((v) => centeredRep(v, q));
	const isShort = centered.every((v) => Math.abs(v) <= 1);

	const solvedCells = solved
		.map((v, i) => {
			const good = v === sMod[i];
			// State via symbol + colour, never colour alone.
			return `<td class="mono-cell ${good ? 'mlwe-cell--hit' : 'mlwe-cell--miss'}">${v}<span class="mlwe-cell-mark" aria-hidden="true">${good ? '✓' : '✗'}</span></td>`;
		})
		.join('');
	const sCells = sMod
		.map((v) => `<td class="mono-cell">${v}</td>`)
		.join('');

	const verdict = useNoise
		? exact
			? `<p class="scenario-status--invalid">Elimination happened to hit s this time — resample; with real ML-KEM noise the recovered vector is essentially never short.</p>`
			: `<p class="scenario-status--valid">✓ Elimination finished — but landed on <strong>x = (${centered
					.map(fmtSignedLwe)
					.join(', ')})</strong>, which is <strong>not short</strong> (${
					isShort ? 'short by luck this draw — resample' : 'entries outside {−1, 0, +1}'
				}) and <strong>not the secret s</strong>. The noise made the unique linear solution useless. This is the felt lattice-hardness: the answer exists, it just is not the short one.</p>`
		: exact
			? `<p class="scenario-status--valid">✓ With no noise, Gaussian elimination recovers <strong>s exactly</strong> in three row operations. No lattice, no hardness — this is why the noise is the whole game.</p>`
			: `<p class="scenario-status--invalid">Unexpected mismatch on a noise-free system — please resample.</p>`;

	return `
		<div class="attack-card mlwe-attack-card">
			<p class="hero-metric-label">Gaussian elimination on A·x = b mod ${q}</p>
			<div class="mlwe-solve-compare">
				<div class="mlwe-matrix">
					<p class="hero-metric-label">Recovered x</p>
					<table class="mlwe-grid" aria-label="Recovered vector x"><tbody><tr>${solvedCells}</tr></tbody></table>
				</div>
				<div class="mlwe-matrix">
					<p class="hero-metric-label">True secret s (mod ${q})</p>
					<table class="mlwe-grid" aria-label="True secret s"><tbody><tr>${sCells}</tr></tbody></table>
				</div>
			</div>
			${verdict}
		</div>
	`;
}

// ---------- 12. References + Glossary ---------------------------------------

function renderRefs(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'refs';
	section.setAttribute('aria-labelledby', 'refs-heading');

	const refs = REFERENCES.map(
		(r) => `
		<li class="ref-row">
			<span class="ref-meta">${r.authors} (${r.year})</span>
			<a class="ref-title" href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title}</a>
			<span class="ref-venue">${r.venue}</span>
		</li>
	`,
	).join('');

	const glossary = GLOSSARY.map(
		(g) => `
		<div class="glossary-row">
			<dt>${g.term}</dt>
			<dd>${g.def}</dd>
		</div>
	`,
	).join('');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 12</p>
				<h2 id="refs-heading">References &amp; glossary</h2>
				<p class="panel-copy">Canonical citations for everything claimed in the demo, plus a short glossary of the terms used.</p>
			</div>
		</div>
		<div class="refs-grid">
			<div>
				<h3 class="refs-subhead">References</h3>
				<ul class="refs-list">${refs}</ul>
			</div>
			<div>
				<h3 class="refs-subhead">Glossary</h3>
				<dl class="glossary">${glossary}</dl>
			</div>
		</div>
	`;
	return section;
}

// ---------- Section nav ------------------------------------------------------

interface NavLink {
	hash: string;
	label: string;
}

const NAV_LINKS: NavLink[] = [
	{ hash: 'decision', label: 'Decide' },
	{ hash: 'generations', label: 'Generations' },
	{ hash: 'dh', label: 'DH' },
	{ hash: 'mitm', label: 'MitM' },
	{ hash: 'ecdh', label: 'ECDH' },
	{ hash: 'kem', label: 'KEM' },
	{ hash: 'hybrid', label: 'Hybrid' },
	{ hash: 'compare', label: 'Compare' },
	{ hash: 'sizes', label: 'Sizes' },
	{ hash: 'history', label: 'History' },
	{ hash: 'production', label: 'Production' },
	{ hash: 'shor', label: 'Shor' },
	{ hash: 'mlwe', label: 'M-LWE' },
	{ hash: 'synthesis', label: 'Synthesis' },
	{ hash: 'refs', label: 'References' },
];

function renderSectionNav(): HTMLElement {
	const nav = el('nav', 'section-nav');
	nav.setAttribute('aria-label', 'Section navigation');
	nav.innerHTML = NAV_LINKS.map(
		(n) => `<a class="section-nav-link" href="#${n.hash}">${n.label}</a>`,
	).join('');
	return nav;
}

function wireDeepLink(): void {
	const id = window.location.hash.replace(/^#/, '');
	if (!id) return;
	const target = document.getElementById(id);
	if (!target) return;
	// Defer one frame so the rendered layout is settled before scrolling.
	requestAnimationFrame(() => {
		target.scrollIntoView({ behavior: 'smooth', block: 'start' });
	});
}

// Sticky-nav scroll-spy: as sections cross above the middle of the viewport
// we mark the matching nav link as is-active. IntersectionObserver lets us
// skip the scroll-listener-on-every-pixel pattern; we rebuild active state
// only when something actually crosses the threshold.
// Number keys 1–9 + 0 jump to the corresponding nav link. Pressing "?"
// toggles a compact help dialog. Shortcuts are suppressed when the user
// is typing into an input — pressing "1" inside the prime field should
// type a 1, not navigate.
function wireKeyboardShortcuts(): void {
	const help = document.createElement('div');
	help.className = 'kbd-help';
	help.setAttribute('role', 'dialog');
	help.setAttribute('aria-modal', 'true');
	help.setAttribute('aria-labelledby', 'kbd-help-title');
	help.hidden = true;
	help.innerHTML = `
		<div class="kbd-help-card">
			<h3 id="kbd-help-title">Keyboard shortcuts</h3>
			<dl>
				${NAV_LINKS.map((n, i) => `<dt><kbd>${i === 9 ? '0' : i + 1}</kbd></dt><dd>Jump to ${n.label}</dd>`).join('')}
				<dt><kbd>?</kbd></dt><dd>Toggle this help</dd>
				<dt><kbd>Esc</kbd></dt><dd>Close help</dd>
			</dl>
			<button type="button" class="kbd-help-close tab-button">Close</button>
		</div>
	`;
	document.body.appendChild(help);
	const closeBtn = help.querySelector<HTMLButtonElement>('.kbd-help-close')!;
	closeBtn.addEventListener('click', () => {
		help.hidden = true;
	});

	function isTyping(): boolean {
		const a = document.activeElement;
		if (!a) return false;
		const tag = a.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select' || (a as HTMLElement).isContentEditable;
	}

	document.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'Escape' && !help.hidden) {
			help.hidden = true;
			return;
		}
		if (isTyping()) return;
		if (e.key === '?') {
			help.hidden = !help.hidden;
			if (!help.hidden) closeBtn.focus();
			e.preventDefault();
			return;
		}
		if (/^[0-9]$/.test(e.key)) {
			const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
			const target = NAV_LINKS[idx];
			if (!target) return;
			const el = document.getElementById(target.hash);
			if (!el) return;
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
			history.replaceState(null, '', `#${target.hash}`);
			e.preventDefault();
		}
	});
}

function wireScrollSpy(): void {
	const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.section-nav-link'));
	if (links.length === 0) return;
	const linkByHash = new Map(links.map((l) => [l.getAttribute('href')?.slice(1) ?? '', l]));
	const visible = new Set<string>();

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const id = entry.target.id;
				if (entry.isIntersecting) visible.add(id);
				else visible.delete(id);
			}
			// Highlight the first visible section in document order so the
			// active link tracks the section you're currently reading.
			const ids = NAV_LINKS.map((n) => n.hash).filter((id) => visible.has(id));
			const active = ids[0];
			for (const link of links) {
				link.classList.toggle(
					'is-active',
					link.getAttribute('href') === `#${active}`,
				);
				if (link.getAttribute('href') === `#${active}`) {
					link.setAttribute('aria-current', 'location');
				} else {
					link.removeAttribute('aria-current');
				}
			}
			// Auto-scroll the nav so the active link is in view (mobile-friendly).
			if (active) {
				const activeLink = linkByHash.get(active);
				activeLink?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
			}
		},
		{ rootMargin: '-20% 0% -65% 0%' },
	);

	for (const link of links) {
		const id = link.getAttribute('href')?.slice(1);
		if (!id) continue;
		const target = document.getElementById(id);
		if (target) observer.observe(target);
	}
}

// ---------- 8. Footer (scripture) -------------------------------------------

function renderFooter(): HTMLElement {
	const footer = el('footer', 'lab-section');
	const reviewed = '2026-06';
	footer.innerHTML = `
		<div class="footer-meta">
			<div class="footer-meta-item">
				<p class="hero-metric-label">Last reviewed</p>
				<p class="mono-inline">${reviewed}</p>
			</div>
			<div class="footer-meta-item">
				<p class="hero-metric-label">Status</p>
				<p class="panel-copy">Educational use only. Tiny parameters by design — they exist so the math is visible and the discrete-log break can run in milliseconds. Use a vetted library (BoringSSL, OpenSSL, liboqs, libsodium, BouncyCastle) for production.</p>
			</div>
		</div>
		<p class="footer-related">Related demos:
			<a href="https://systemslibrarian.github.io/crypto-lab-curve-lens/" target="_blank" rel="noopener">crypto-lab-curve-lens</a> ·
			<a href="https://systemslibrarian.github.io/crypto-lab-hybrid-wire/" target="_blank" rel="noopener">crypto-lab-hybrid-wire</a> ·
			<a href="https://systemslibrarian.github.io/crypto-lab-pq-tls-handshake/" target="_blank" rel="noopener">crypto-lab-pq-tls-handshake</a> ·
			<a href="https://systemslibrarian.github.io/crypto-lab-x3dh-wire/" target="_blank" rel="noopener">crypto-lab-x3dh-wire</a> ·
			<a href="https://systemslibrarian.github.io/crypto-lab-noise-pipe/" target="_blank" rel="noopener">crypto-lab-noise-pipe</a>
		</p>
		<p class="scripture">"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31</p>
	`;
	return footer;
}

// ---------- mountApp ---------------------------------------------------------

export function mountApp(root: HTMLDivElement): void {
	const state: SharedSecrets = { dh: 0, kem: '' };

	const shell = el('div', 'page-shell');
	shell.id = 'playground-heading';

	shell.appendChild(renderHero());
	shell.appendChild(renderSectionNav());
	shell.appendChild(renderBeginnerBanner());
	shell.appendChild(renderDecisionCard());
	shell.appendChild(renderTimeline());
	const dhSection = renderDhPlayground();
	shell.appendChild(dhSection);
	shell.appendChild(renderMitm());
	shell.appendChild(renderEcdhPlayground());
	shell.appendChild(renderKemSection(state));
	shell.appendChild(
		renderHybridSection(state, () => {
			const p = clampInt((dhSection.querySelector('#dh-p') as HTMLInputElement).value, 3, 9973, 23);
			const g = clampInt((dhSection.querySelector('#dh-g') as HTMLInputElement).value, 2, p - 1, 5);
			const a = clampInt((dhSection.querySelector('#dh-a') as HTMLInputElement).value, 1, p - 1, 6);
			const b = clampInt((dhSection.querySelector('#dh-b') as HTMLInputElement).value, 1, p - 1, 15);
			const r = diffieHellman(p, g, a, b);
			state.dh = r.sharedFromAlice;
			return r.sharedFromAlice;
		}),
	);
	shell.appendChild(renderCompare());
	shell.appendChild(renderSizes());
	shell.appendChild(renderHistory());
	shell.appendChild(renderDeployments());
	shell.appendChild(renderShor());
	shell.appendChild(renderModuleLwe());
	shell.appendChild(renderSynthesis());
	shell.appendChild(renderRefs());
	shell.appendChild(renderFooter());

	root.replaceChildren(shell);

	wireDeepLink();
	window.addEventListener('hashchange', wireDeepLink);
	wireScrollSpy();
	wireKeyboardShortcuts();
	wireCopyButtons(shell);
}
