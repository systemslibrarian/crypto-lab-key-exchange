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
	ecdh,
	hybridCombine,
	mlkemEncapsulateDemo,
	pointToString,
	type DhResult,
	type EcdhResult,
	type KemResult,
} from './engine.ts';
import { GENERATIONS, WHY_IT_MATTERS, type Generation } from './data.ts';

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

// ---------- 1. Hero ----------------------------------------------------------

function renderHero(): HTMLElement {
	const hero = el('section', 'hero-panel');
	hero.innerHTML = `
		<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to light mode">🌙</button>
		<div class="hero-copy">
			<p class="eyebrow">Key Exchange · Evolution</p>
			<h1>Key Exchange</h1>
			<p class="hero-text">
				One problem — agree on a shared secret over an open channel — has been solved five
				different ways in fifty years. Diffie–Hellman, ECDH, and X25519 are the same idea in
				progressively stronger groups; ML-KEM is a genuinely different mechanism built for a
				post-quantum world; and hybrid X25519+ML-KEM is the bridge the industry is crossing
				right now.
			</p>
			<details class="why-details">
				<summary>Why does this keep changing?</summary>
				<p>
					DH → ECDH → X25519 is one continuous line: the same exponentiation idea, just moved
					into a smaller, faster, less back-door-suspicious group each time. The math is the
					same — and so is the weakness, because Shor’s algorithm breaks discrete logs in any
					abelian group. ML-KEM steps off that line entirely: a Key Encapsulation Mechanism
					over polynomial rings whose security rests on Module-LWE, which Shor doesn’t touch.
					Hybrid combines both so neither half failing breaks the channel.
				</p>
			</details>
		</div>
		<div class="hero-metric-card">
			<p class="hero-metric-label">At a glance</p>
			<p class="hero-metric-value">5 generations · 1976 → 2024</p>
			<p class="hero-metric-note">Three of the five are broken by a sufficiently large quantum computer. The other two — ML-KEM and hybrid X25519+ML-KEM — are what production deployments are migrating to today.</p>
		</div>
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

	const detail = el('div', 'gen-detail');
	detail.setAttribute('role', 'tabpanel');
	detail.tabIndex = 0;

	const buttons: HTMLButtonElement[] = GENERATIONS.map((gen, idx) => {
		const btn = el('button', 'gen-pill');
		btn.type = 'button';
		btn.setAttribute('role', 'tab');
		btn.setAttribute('aria-selected', 'false');
		btn.dataset.id = gen.id;
		btn.innerHTML = `
			<span class="gen-pill-year">${gen.year}</span>
			<span class="gen-pill-name">${gen.name}</span>
			<span class="gen-pill-chip ${gen.pqSafe ? 'chip-safe' : 'chip-broken'}">${gen.pqSafe ? 'PQ-safe' : 'Quantum-broken'}</span>
		`;
		btn.addEventListener('click', () => select(idx));
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
		});
		const gen = GENERATIONS[idx]!;
		detail.innerHTML = renderGenerationDetail(gen);
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
	}

	[pInput, gInput, aInput, bInput].forEach((i) => i.addEventListener('input', rerun));

	attackBtn.addEventListener('click', () => {
		const { p, g, a, b } = read();
		const A = diffieHellman(p, g, a, b).A;
		const recovered = discreteLogAttack(g, A, p);
		attackOut.innerHTML = renderDhAttack(recovered, a, A, g, p);
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
				<p class="mono-inline">shared = B<sup>a</sup> mod p = ${r.B}<sup>${r.a}</sup> mod ${r.p} = <strong>${r.sharedFromAlice}</strong></p>
			</div>
			<div class="kx-side">
				<p class="hero-metric-label">Bob</p>
				<p class="mono-inline">B = g<sup>b</sup> mod p = ${r.g}<sup>${r.b}</sup> mod ${r.p} = <strong>${r.B}</strong></p>
				<p class="mono-inline">shared = A<sup>b</sup> mod p = ${r.A}<sup>${r.b}</sup> mod ${r.p} = <strong>${r.sharedFromBob}</strong></p>
			</div>
		</div>
		<p class="kx-status">${status}</p>
	`;
}

function renderDhAttack(recovered: number | null, real: number, A: number, g: number, p: number): string {
	if (recovered === null) {
		return `<p class="scenario-status--invalid">Brute force found no exponent — check inputs (g should be a generator mod p).</p>`;
	}
	const matches = recovered === real;
	return `
		<div class="attack-card">
			<p class="hero-metric-label">Eve, watching the wire</p>
			<p class="mono-inline">Observed: g=${g}, p=${p}, A=${A}</p>
			<p class="mono-inline">Brute force: try x = 1, 2, … until g<sup>x</sup> mod p = A</p>
			<p class="mono-inline">Recovered Alice’s secret: <strong>x = ${recovered}</strong> ${matches ? '✓' : '(matches a different exponent in same residue class)'}</p>
			<p class="kx-footnote">This is only feasible because <code>p</code> is tiny. Real Diffie–Hellman uses 2048–4096-bit primes where this brute force is astronomically infeasible (and even index-calculus, the best classical attack, is sub-exponential).</p>
		</div>
	`;
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
				<p class="section-kicker">Section · 3</p>
				<h2 id="ecdh-heading">Live ECDH</h2>
				<p class="panel-copy">The same Diffie–Hellman idea, on an elliptic curve. We use a tiny teaching curve so every point is visible.</p>
			</div>
		</div>
		<p class="kx-curve">Curve: <code>y² = x³ + ${c.a}x + ${c.b} (mod ${c.p})</code> &nbsp;·&nbsp; generator <code>G = ${pointToString(c.G)}</code> &nbsp;·&nbsp; order <code>n = ${c.n}</code></p>
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
		<div id="ec-output" class="kx-output" aria-live="polite"></div>
	`;

	const aInput = section.querySelector<HTMLInputElement>('#ec-a')!;
	const bInput = section.querySelector<HTMLInputElement>('#ec-b')!;
	const output = section.querySelector<HTMLElement>('#ec-output')!;

	function rerun(): void {
		const a = clampInt(aInput.value, 1, c.n - 1, 3);
		const b = clampInt(bInput.value, 1, c.n - 1, 9);
		const r = ecdh(c, a, b);
		output.innerHTML = renderEcdhResult(r);
	}

	[aInput, bInput].forEach((i) => i.addEventListener('input', rerun));

	rerun();
	return section;
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

// ---------- 5. KEM flow ------------------------------------------------------

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
				<p class="section-kicker">Section · 4</p>
				<h2 id="kem-heading">The mechanic shift: KEM vs DH</h2>
				<p class="panel-copy">DH and ECDH have <em>both</em> sides exponentiate to a shared value. A KEM has Bob <em>encapsulate</em> a fresh secret to Alice’s public key, and Alice <em>decapsulates</em>. Different shape, same end state.</p>
			</div>
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
		try {
			const r = await mlkemEncapsulateDemo();
			state.kem = r.aliceSecret;
			output.innerHTML = renderKemResult(r);
			window.dispatchEvent(new CustomEvent('kx-state-changed'));
		} catch (err) {
			output.innerHTML = `<p class="scenario-status--invalid">Encapsulation failed: ${(err as Error).message}</p>`;
		} finally {
			btn.disabled = false;
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
				<p class="mono-inline">secret = <strong>${shortHex(r.bobSecret)}</strong></p>
				<p class="mono-inline">ciphertext → Alice = <strong>${shortHex(r.ciphertext)}</strong></p>
			</div>
			<div class="kx-side">
				<p class="hero-metric-label">Alice (decapsulator)</p>
				<p class="mono-inline">recovered secret = <strong>${shortHex(r.aliceSecret)}</strong></p>
				<p class="mono-inline">agree: ${r.agree ? '✓' : '✗'}</p>
			</div>
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
				<p class="section-kicker">Section · 5</p>
				<h2 id="hybrid-heading">Hybrid combine</h2>
				<p class="panel-copy">Take the DH shared secret and the ML-KEM secret, hash them together, and use the result as the session key. The channel survives unless <em>both</em> halves break.</p>
			</div>
		</div>
		<div class="kx-actions">
			<button id="hybrid-run" class="tab-button" type="button">Combine DH + KEM</button>
		</div>
		<div id="hybrid-output" class="kx-output" aria-live="polite"></div>
	`;

	const btn = section.querySelector<HTMLButtonElement>('#hybrid-run')!;
	const output = section.querySelector<HTMLElement>('#hybrid-output')!;

	async function run(): Promise<void> {
		btn.disabled = true;
		try {
			const dh = getDh();
			const kem = state.kem;
			if (!kem) {
				output.innerHTML = `<p class="scenario-status--pending">Run the KEM section first so the hybrid combine has a post-quantum half to mix in.</p>`;
				return;
			}
			const session = await hybridCombine(dh, kem);
			output.innerHTML = `
				<div class="kx-side">
					<p class="hero-metric-label">Inputs</p>
					<p class="mono-inline">dh = ${dh}</p>
					<p class="mono-inline">kem = ${shortHex(kem)}</p>
				</div>
				<div class="kx-side">
					<p class="hero-metric-label">Session key = SHA-256(dh ‖ kem)</p>
					<p class="mono-inline">${session}</p>
				</div>
				<p class="kx-footnote">This is the bridge protocol in production today — X25519MLKEM768 in TLS 1.3, Apple iMessage PQ3, AWS KMS. Secure if either half holds.</p>
			`;
		} catch (err) {
			output.innerHTML = `<p class="scenario-status--invalid">Combine failed: ${(err as Error).message}</p>`;
		} finally {
			btn.disabled = false;
		}
	}

	btn.addEventListener('click', () => {
		void run();
	});

	window.addEventListener('kx-state-changed', () => {
		void run();
	});

	return section;
}

// ---------- 7. Why it matters ------------------------------------------------

function renderWhyItMatters(): HTMLElement {
	const section = el('section', 'lab-section');
	section.id = 'why';
	section.setAttribute('aria-labelledby', 'why-heading');

	const cards = WHY_IT_MATTERS.map(
		(km) => `
		<div class="panel-card">
			<h3>${km.title}</h3>
			${km.year ? `<p class="hero-metric-label">${km.year}</p>` : ''}
			<p class="panel-copy">${km.body}</p>
		</div>
	`,
	).join('');

	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Section · 6</p>
				<h2 id="why-heading">Why it matters</h2>
				<p class="panel-copy">The migration story in four cards.</p>
			</div>
		</div>
		<div class="reuse-grid">${cards}</div>
	`;
	return section;
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
	shell.appendChild(renderTimeline());
	const dhSection = renderDhPlayground();
	shell.appendChild(dhSection);
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
	shell.appendChild(renderWhyItMatters());
	shell.appendChild(renderFooter());

	root.replaceChildren(shell);
}
