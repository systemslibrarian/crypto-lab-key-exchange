import { enc, equalBytes, toHex } from './aes.ts';
import { eveBruteForce, makeEvePayload, type EvePayload, type EveResult } from './eve-core.ts';
import {
	aliceLookup,
	bobSolve,
	buildPuzzles,
	PuzzleIntegrityError,
	type AliceState,
	type BobResult,
	type PuzzleMode,
} from './protocol.ts';
import { saltedTableAttempt, tableAttack } from './textbook-form.ts';
import { eveTrialVariance, expectedBobTrials, expectedEveTrials } from './work.ts';

const EVE_CAP = 2 ** 24;
const FALLBACK_CAP = 2 ** 18;

interface WorkerProgressMessage {
	type: 'progress';
	runId: number;
	progress: { operations: number; puzzlesTried: number };
}

interface WorkerResultMessage {
	type: 'result';
	runId: number;
	result: EveResult;
}

interface WorkerErrorMessage {
	type: 'error';
	runId: number;
	message: string;
}

type EveWorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

declare global {
	interface Window {
		/** Browser-test seam: the same noble AES block call used by the protocol. */
		__merkleAesEnc?: (key: number[], block: number[]) => number[];
	}
}

function formatCount(value: number): string {
	return Number.isInteger(value)
		? value.toLocaleString('en-US')
		: value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function samplePuzzleHtml(state: AliceState): string {
	return state.puzzles.slice(0, 3).map((puzzle, index) => `
		<li>
			<span class="puzzle-sample-label">sent puzzle ${index + 1}</span>
			<code>${toHex(puzzle.prefix).slice(0, 20)}…</code>
			<code>${toHex(puzzle.cSecret).slice(0, 20)}…</code>
			<code>${toHex(puzzle.cIndex).slice(0, 20)}…</code>
			<code>${toHex(puzzle.cCheck).slice(0, 20)}…</code>
		</li>
	`).join('');
}

function logWidth(value: number): string {
	if (value <= 0) return '0%';
	const percentage = Math.min(100, Math.max(2, (Math.log2(Math.max(1, value)) / 24) * 100));
	return `${percentage.toFixed(1)}%`;
}

export function renderPuzzles(): HTMLElement {
	const section = document.createElement('section');
	section.className = 'lab-section puzzle-lab';
	section.id = 'puzzles';
	section.setAttribute('aria-labelledby', 'puzzles-heading');
	section.innerHTML = `
		<div class="section-heading-row">
			<div>
				<p class="section-kicker">Prequel · 1978</p>
				<h2 id="puzzles-heading">Before public keys: Merkle puzzles</h2>
				<p class="panel-copy">Alice locks a thousand small boxes with weak locks. Each box holds a random number and a secret. Bob picks one box and picks its lock, then announces only the number. A watcher has to pick boxes until she finds that number. That work gap is the whole protocol — and it is not enough.</p>
			</div>
		</div>
		<div class="toy-banner" role="note">
			<span class="toy-banner-tag">Toy parameters</span>
			<span class="toy-banner-body"><var>b</var>-bit weak suffixes run here; Boneh–Shoup’s example uses |K| = 2<sup>30</sup>.</span>
		</div>
		<div class="threat-strip" role="note" aria-label="Threat model for Merkle puzzles">
			<span class="threat-chip threat-chip--no">LIMITED: quadratic gap against a passive eavesdropper</span>
			<span class="threat-chip threat-chip--no">✗ vs Active MitM</span>
			<span class="threat-chip threat-chip--no">✗ vs Large quantum computer</span>
		</div>
		<div class="puzzle-source-note panel-card">
			<p class="hero-metric-label">What this lab changes</p>
			<p class="panel-copy">The <a href="https://crypto.stanford.edu/~dabo/cryptobook/BonehShoup_0_6.pdf" target="_blank" rel="noopener noreferrer">book’s Protocol 10.1</a> gives every puzzle the same reduced AES key space and the same check block. That printed form falls to one reusable table. The default here gives every puzzle a fresh public key prefix, restoring independent work; the switch below preserves the printed form as a deliberately broken comparison.</p>
		</div>
		<div class="puzzle-controls panel-card" role="group" aria-label="Merkle puzzle parameters">
			<div class="puzzle-control-pair">
				<label for="puzzle-b-range">Weak key bits <var>b</var>: <output id="puzzle-b-output" for="puzzle-b-range puzzle-b-number">10</output></label>
				<input id="puzzle-b-range" type="range" min="8" max="14" step="1" value="10" />
				<label class="puzzle-number-label" for="puzzle-b-number">Keyboard value</label>
				<input id="puzzle-b-number" type="number" min="8" max="14" step="1" value="10" inputmode="numeric" />
			</div>
			<div class="puzzle-control-pair">
				<label for="puzzle-l-range">Puzzle count <var>L</var>: <output id="puzzle-l-output" for="puzzle-l-range puzzle-l-number">1,024</output></label>
				<input id="puzzle-l-range" type="range" min="256" max="4096" step="1" value="1024" />
				<label class="puzzle-number-label" for="puzzle-l-number">Keyboard value</label>
				<input id="puzzle-l-number" type="number" min="256" max="4096" step="1" value="1024" inputmode="numeric" />
			</div>
			<label class="puzzle-mode-switch">
				<input id="puzzle-textbook" type="checkbox" role="switch" />
				<span><strong>Textbook form — BROKEN</strong><small>Shared zero prefix, fixed check block; never the default.</small></span>
			</label>
			<div class="puzzle-actions">
				<button id="puzzle-build" class="tab-button" type="button">Build puzzles</button>
				<button id="puzzle-bob" class="tab-button" type="button" disabled>Bob solves one</button>
				<button id="puzzle-eve" class="tab-button" type="button" disabled>Run Eve</button>
				<button id="puzzle-cancel" class="tab-button" type="button" disabled>Cancel Eve</button>
			</div>
		</div>
		<p id="puzzle-status" class="puzzle-status" role="status" aria-live="polite">Building the default independent puzzles…</p>
		<div id="puzzle-retired" class="puzzle-retired" role="status" aria-live="polite" hidden></div>
		<div class="puzzle-grid">
			<article class="panel-card">
				<p class="hero-metric-label">1 · Alice builds and shuffles</p>
				<h3>Three AES blocks per puzzle</h3>
				<p class="panel-copy">Each ciphertext holds a 128-bit secret, an index from 1 through L, or an all-zero check block. Zero is reserved for the check, so the index ciphertext cannot identify a puzzle by matching it. Only the public prefix and ciphertexts cross the channel.</p>
				<ul id="puzzle-samples" class="puzzle-samples" aria-label="First three shuffled puzzles"></ul>
			</article>
			<article class="panel-card">
				<p class="hero-metric-label">2 · Bob picks one</p>
				<h3>Try weak suffixes until the check decrypts to zero</h3>
				<p class="panel-copy">Bob publishes the decrypted index, not the secret. Alice uses that index to select her copy.</p>
				<div id="puzzle-agreement" class="puzzle-verdict" role="status" aria-live="polite">Build the puzzles, then let Bob solve one.</div>
				<button id="puzzle-corrupt-bob" class="tab-button puzzle-break-button" type="button" disabled>Break it yourself: flip Bob’s copy</button>
			</article>
			<article class="panel-card">
				<p class="hero-metric-label">3 · Test the one-table attack</p>
				<h3>Does one table serve every puzzle?</h3>
				<div id="puzzle-table-verdict" class="puzzle-verdict" role="status" aria-live="polite">No table has run yet.</div>
			</article>
			<article class="panel-card">
				<p class="hero-metric-label">4 · Eve sees the transcript only</p>
				<h3>Pick locks until Bob’s index appears</h3>
				<p class="panel-copy">The worker receives the shuffled ciphertexts, public prefixes, <var>b</var>, and Bob’s index — never a weak suffix, plaintext secret, or Bob’s chosen position.</p>
				<div id="puzzle-eve-verdict" class="puzzle-verdict" role="status" aria-live="polite">Run Bob first, then run Eve.</div>
			</article>
		</div>
		<article class="panel-card puzzle-work-card">
			<div class="puzzle-work-heading">
				<div>
					<p class="hero-metric-label">Headline mechanism</p>
					<h3>The work meter</h3>
				</div>
				<p class="panel-copy">Measured bars advance only beside real AES calls. Predictions are derived here from uniform choices, not quoted as test data.</p>
			</div>
			<div class="puzzle-work" role="group" aria-label="Predicted and measured AES work">
				<div class="puzzle-work-row" data-claim="alice-work">
					<span class="puzzle-work-label">Alice</span>
					<div class="puzzle-work-track"><span id="puzzle-alice-bar" class="puzzle-work-bar"></span></div>
					<span><strong id="puzzle-alice-actual">—</strong> measured · <span id="puzzle-alice-predicted">—</span> predicted</span>
					<code id="puzzle-alice-formula">3L</code>
				</div>
				<div class="puzzle-work-row" data-claim="bob-work">
					<span class="puzzle-work-label">Bob</span>
					<div class="puzzle-work-track"><span id="puzzle-bob-bar" class="puzzle-work-bar"></span></div>
					<span><strong id="puzzle-bob-actual">—</strong> measured · <span id="puzzle-bob-predicted">—</span> expected</span>
					<code id="puzzle-bob-formula">(|K| + 1) / 2</code>
				</div>
				<div class="puzzle-work-row" data-claim="eve-work">
					<span class="puzzle-work-label">Eve</span>
					<div class="puzzle-work-track"><span id="puzzle-eve-bar" class="puzzle-work-bar puzzle-work-bar--alarm"></span></div>
					<span><strong id="puzzle-eve-actual">—</strong> measured · <span id="puzzle-eve-predicted">—</span> expected <small id="puzzle-eve-tolerance"></small></span>
					<code id="puzzle-eve-formula">((L + 1) / 2) × ((|K| + 1) / 2)</code>
				</div>
			</div>
			<p id="puzzle-counter-note" class="panel-copy">Bob’s displayed trial count stops at the first match; the full-space uniqueness audit and two follow-up decryptions are reported with his result. Eve’s counter counts marker-decryption trials; post-match index and secret decryptions are reported separately.</p>
		</article>
		<article class="panel-card puzzle-scale-card">
			<p class="hero-metric-label">At real scale · computed, not run</p>
			<h3>Honest work ≈ 2<sup>30</sup>; independent-puzzle eavesdropping ≈ 2<sup>58</sup></h3>
			<p class="panel-copy">With <var>L</var> ≈ |K| ≈ 2<sup>30</sup>, the expected-half formulas above give roughly 2<sup>30</sup> work for each honest party and 2<sup>58</sup> trial decryptions for Eve. <a href="https://www.iacr.org/conferences/crypto2009/acceptedpapers.html" target="_blank" rel="noopener noreferrer">Barak and Mahmoody</a> prove a matching O(n²)-query attack on any random-oracle key exchange. <a href="https://doi.org/10.1145/73007.73012" target="_blank" rel="noopener noreferrer">Impagliazzo and Rudich</a> show why black-box one-way functions do not yield the larger gap public-key cryptography needs. Diffie–Hellman’s next move rests on a hardness assumption instead.</p>
			<p class="panel-copy"><a href="https://www.iacr.org/conferences/crypto2011/abstracts/385.htm" target="_blank" rel="noopener noreferrer">Brassard et al.</a> show that Merkle’s classical scheme is completely insecure against a quantum eavesdropper; the Grover lab follows that search story.</p>
		</article>
		<p id="puzzle-negative-claim" class="puzzle-negative-claim" data-claim="puzzle-negative">Merkle puzzles give only a quadratic work gap: an eavesdropper who spends about L·|K| block-cipher operations recovers the secret. The protocol is not secure in the cryptographic sense.</p>
	`;

	const bRange = section.querySelector<HTMLInputElement>('#puzzle-b-range')!;
	const bNumber = section.querySelector<HTMLInputElement>('#puzzle-b-number')!;
	const bOutput = section.querySelector<HTMLOutputElement>('#puzzle-b-output')!;
	const lRange = section.querySelector<HTMLInputElement>('#puzzle-l-range')!;
	const lNumber = section.querySelector<HTMLInputElement>('#puzzle-l-number')!;
	const lOutput = section.querySelector<HTMLOutputElement>('#puzzle-l-output')!;
	const textbook = section.querySelector<HTMLInputElement>('#puzzle-textbook')!;
	const buildButton = section.querySelector<HTMLButtonElement>('#puzzle-build')!;
	const bobButton = section.querySelector<HTMLButtonElement>('#puzzle-bob')!;
	const eveButton = section.querySelector<HTMLButtonElement>('#puzzle-eve')!;
	const cancelButton = section.querySelector<HTMLButtonElement>('#puzzle-cancel')!;
	const corruptButton = section.querySelector<HTMLButtonElement>('#puzzle-corrupt-bob')!;
	const status = section.querySelector<HTMLElement>('#puzzle-status')!;
	const retired = section.querySelector<HTMLElement>('#puzzle-retired')!;
	const samples = section.querySelector<HTMLElement>('#puzzle-samples')!;
	const agreement = section.querySelector<HTMLElement>('#puzzle-agreement')!;
	const tableVerdict = section.querySelector<HTMLElement>('#puzzle-table-verdict')!;
	const eveVerdict = section.querySelector<HTMLElement>('#puzzle-eve-verdict')!;

	let alice: AliceState | undefined;
	let bob: BobResult | undefined;
	let displayedBobSecret: Uint8Array | undefined;
	let worker: Worker | undefined;
	let runId = 0;
	let builtParameters = '';
	let eveRecovered = false;

	window.__merkleAesEnc = (key, block) => Array.from(enc(Uint8Array.from(key), Uint8Array.from(block)));

	function parameters(): { b: number; count: number; mode: PuzzleMode } | undefined {
		const b = Number(bNumber.value);
		const count = Number(lNumber.value);
		if (!Number.isInteger(b) || b < 8 || b > 14) {
			status.textContent = 'Refused: b must be an integer from 8 through 14.';
			return undefined;
		}
		if (!Number.isInteger(count) || count < 2 ** 8 || count > 2 ** 12) {
			status.textContent = 'Refused: L must be an integer from 2^8 (256) through 2^12 (4,096).';
			return undefined;
		}
		return { b, count, mode: textbook.checked ? 'textbook' : 'salted' };
	}

	function parameterKey(): string {
		return `${bNumber.value}|${lNumber.value}|${textbook.checked}`;
	}

	function setMeter(party: 'alice' | 'bob' | 'eve', actual: number | undefined, predicted: number): void {
		section.querySelector<HTMLElement>(`#puzzle-${party}-actual`)!.textContent = actual === undefined ? '—' : formatCount(actual);
		section.querySelector<HTMLElement>(`#puzzle-${party}-predicted`)!.textContent = formatCount(predicted);
		section.querySelector<HTMLElement>(`#puzzle-${party}-bar`)!.style.width = actual === undefined ? '0%' : logWidth(actual);
	}

	function cancelEve(): void {
		// Invalidates queued worker messages and asynchronous fallback callbacks.
		runId += 1;
		if (worker) {
			worker.postMessage({ type: 'cancel', runId });
			worker.terminate();
			worker = undefined;
		}
		cancelButton.disabled = true;
		eveButton.disabled = !bob;
	}

	function retire(reason: string): void {
		if (parameterKey() === builtParameters) return;
		cancelEve();
		alice = undefined;
		bob = undefined;
		displayedBobSecret = undefined;
		eveRecovered = false;
		bobButton.disabled = true;
		eveButton.disabled = true;
		corruptButton.disabled = true;
		samples.replaceChildren();
		agreement.removeAttribute('data-verdict');
		tableVerdict.removeAttribute('data-verdict');
		eveVerdict.removeAttribute('data-verdict');
		agreement.textContent = 'Verdict retired — rebuild with the new parameters.';
		tableVerdict.textContent = 'Verdict retired — rebuild with the new parameters.';
		eveVerdict.textContent = 'Verdict retired — rebuild with the new parameters.';
		retired.hidden = false;
		retired.textContent = `Previous results retired: ${reason}`;
		status.textContent = retired.textContent;
		setMeter('alice', undefined, 0);
		setMeter('bob', undefined, 0);
		setMeter('eve', undefined, 0);
	}

	function syncPair(source: HTMLInputElement, destination: HTMLInputElement, output: HTMLOutputElement): void {
		destination.value = source.value;
		const n = Number(source.value);
		output.textContent = Number.isFinite(n) ? formatCount(n) : 'invalid';
	}

	for (const [source, destination, output] of [
		[bRange, bNumber, bOutput],
		[bNumber, bRange, bOutput],
		[lRange, lNumber, lOutput],
		[lNumber, lRange, lOutput],
	] as const) {
		source.addEventListener('input', () => {
			syncPair(source, destination, output);
			retire('a puzzle parameter changed.');
		});
	}
	textbook.addEventListener('change', () => retire('the protocol form changed.'));

	function renderAgreement(): void {
		if (!alice || !bob || !displayedBobSecret) return;
		const aliceSecret = aliceLookup(alice, bob.index);
		const agreed = equalBytes(aliceSecret, displayedBobSecret);
		agreement.dataset.verdict = 'puzzle-agreement';
		agreement.className = `puzzle-verdict ${agreed ? 'puzzle-verdict--safe' : 'puzzle-verdict--alarm'}`;
		const headline = agreed
			? (eveRecovered ? 'AGREED — AND RECOVERED BY THE EAVESDROPPER' : 'AGREED — Alice and Bob hold the same 128-bit secret')
			: 'NOT AGREED — the two 128-bit values differ';
		agreement.innerHTML = `
			<strong id="puzzle-agreement-headline">${headline}</strong>
			<span>Bob published index <code id="puzzle-index">${bob.index}</code>; exactly <code id="puzzle-matching-keys">${bob.matchingKeys}</code> key passed the check.</span>
			<span>Alice: <code id="puzzle-alice-secret">${toHex(aliceSecret)}</code></span>
			<span>Bob: <code id="puzzle-bob-secret">${toHex(displayedBobSecret)}</code></span>
			<span>Uniqueness audit: ${formatCount(bob.auditOps)} additional AES decryptions after the first match.</span>
			<span>Index and secret: <code id="puzzle-bob-auxiliary">${bob.auxiliaryOps}</code> follow-up AES decryptions.</span>
		`;
	}

	function build(): void {
		cancelEve();
		const p = parameters();
		if (!p) return;
		buildButton.disabled = true;
		status.textContent = 'Building and shuffling real AES puzzles…';
		try {
			alice = buildPuzzles(p.count, p.b, p.mode);
			bob = undefined;
			displayedBobSecret = undefined;
			eveRecovered = false;
			builtParameters = parameterKey();
			retired.hidden = true;
			samples.innerHTML = samplePuzzleHtml(alice);
			bobButton.disabled = false;
			eveButton.disabled = true;
			corruptButton.disabled = true;
			agreement.removeAttribute('data-verdict');
			agreement.className = 'puzzle-verdict';
			agreement.textContent = 'Puzzles ready. Bob has not selected one yet.';
			eveVerdict.removeAttribute('data-verdict');
			eveVerdict.className = 'puzzle-verdict';
			eveVerdict.textContent = 'Run Bob first, then run Eve.';
			setMeter('alice', alice.aliceOps, 3 * p.count);
			setMeter('bob', undefined, expectedBobTrials(p.b));
			setMeter('eve', undefined, expectedEveTrials(p.count, p.b));
			const eveTolerance = 6 * Math.sqrt(eveTrialVariance(p.count, p.b));
			section.querySelector<HTMLElement>('#puzzle-eve-tolerance')!.textContent = `· six-sigma single-run tolerance ±${formatCount(eveTolerance)}`;

			tableVerdict.dataset.verdict = 'puzzle-table';
			if (p.mode === 'textbook') {
				const result = tableAttack(alice.puzzles, p.b, 1);
				tableVerdict.className = 'puzzle-verdict puzzle-verdict--alarm';
				tableVerdict.innerHTML = `<strong>BROKEN — one table of ${formatCount(result.tableOps)} encryptions solved all ${formatCount(result.solved)} puzzles</strong><span>${formatCount(result.lookupOps)} lookups and ${formatCount(result.decryptOps)} follow-up AES decryptions recovered every index and secret.</span>`;
				status.textContent = `Built ${formatCount(p.count)} textbook-form puzzles. BROKEN: shared key space, fixed check block.`;
			} else {
				const result = saltedTableAttempt(alice.puzzles, p.b);
				tableVerdict.className = result.matches === 0
					? 'puzzle-verdict puzzle-verdict--safe'
					: 'puzzle-verdict puzzle-verdict--alarm';
				tableVerdict.innerHTML = result.matches === 0
					? `<strong>SAFE — table matches 0 puzzles — puzzles are independent</strong><span>The same ${formatCount(result.tableOps)}-entry zero-prefix table was tried against all ${formatCount(result.lookupOps)} shuffled puzzles.</span>`
					: `<strong>TABLE MATCH — zero-prefix table matched ${formatCount(result.matches)} salted puzzles</strong><span>Independent random prefixes or check values can collide by chance; this run did not pass the zero-match control.</span>`;
				status.textContent = `Built and shuffled ${formatCount(p.count)} independent-prefix puzzles in memory.`;
			}
		} catch (error) {
			status.textContent = `Build refused: ${error instanceof Error ? error.message : String(error)}`;
			alice = undefined;
			bobButton.disabled = true;
		} finally {
			buildButton.disabled = false;
		}
	}

	function solveBob(): void {
		if (!alice) return;
		cancelEve();
		eveRecovered = false;
		eveVerdict.removeAttribute('data-verdict');
		eveVerdict.className = 'puzzle-verdict';
		eveVerdict.textContent = 'Eve’s previous result was retired: Bob is selecting a new puzzle.';
		setMeter('eve', undefined, expectedEveTrials(alice.count, alice.b));
		status.textContent = 'Bob is trying real AES keys…';
		try {
			bob = bobSolve(alice.puzzles, alice.b);
			displayedBobSecret = bob.secret.slice();
			eveRecovered = false;
			renderAgreement();
			setMeter('bob', bob.trials, expectedBobTrials(alice.b));
			eveButton.disabled = false;
			corruptButton.disabled = false;
			status.textContent = `Bob opened one puzzle after ${formatCount(bob.trials)} trial decryptions and published index ${bob.index}.`;
		} catch (error) {
			bob = undefined;
			displayedBobSecret = undefined;
			eveButton.disabled = true;
			corruptButton.disabled = true;
			agreement.dataset.verdict = 'puzzle-agreement';
			agreement.className = 'puzzle-verdict puzzle-verdict--alarm';
			if (error instanceof PuzzleIntegrityError && error.reason === 'ambiguous-key') {
				agreement.textContent = `RESTART REQUIRED — ${error.message}`;
			} else {
				agreement.textContent = `INTEGRITY ERROR — ${error instanceof Error ? error.message : String(error)}`;
			}
		}
	}

	function finishEve(result: EveResult, fallback: boolean, currentRun: number): void {
		if (currentRun !== runId) return;
		runId += 1;
		worker = undefined;
		cancelButton.disabled = true;
		eveButton.disabled = false;
		setMeter('eve', result.operations, alice ? expectedEveTrials(alice.count, alice.b) : 0);
		eveVerdict.dataset.verdict = 'puzzle-eve';
		if (result.status === 'recovered' && bob && equalBytes(result.secret, bob.secret)) {
			eveRecovered = true;
			renderAgreement();
			const ratio = result.operations / Math.max(1, bob.trials);
			eveVerdict.className = 'puzzle-verdict puzzle-verdict--alarm';
			eveVerdict.innerHTML = `<strong>RECOVERED BY THE EAVESDROPPER — after ${formatCount(result.operations)} operations (≈ ${formatCount(ratio)}× Bob’s)</strong><span>${formatCount(result.puzzlesTried)} puzzles tried; ${formatCount(result.auxiliaryOps)} post-match AES decryptions. ${fallback ? 'Main-thread fallback cap was used.' : 'Worker used the transcript only.'}</span>`;
			status.textContent = 'Eve recovered the same 128-bit secret from public transcript data.';
		} else if (result.status === 'incomplete') {
			eveRecovered = false;
			renderAgreement();
			eveVerdict.className = 'puzzle-verdict puzzle-verdict--alarm';
			eveVerdict.innerHTML = `<strong>INCOMPLETE — stopped at the ${formatCount(result.operations)}-trial cap</strong><span>${fallback ? 'Main-thread fallback cap was used. ' : ''}The expected work above is extrapolated from the uniform-choice formula; no recovery is claimed.</span>`;
			status.textContent = 'Eve’s run stopped at its cap; the larger value is extrapolated, not measured.';
		} else {
			eveRecovered = false;
			renderAgreement();
			eveVerdict.className = 'puzzle-verdict puzzle-verdict--alarm';
			eveVerdict.textContent = result.status === 'recovered'
				? 'INTEGRITY ERROR — Eve’s recovered secret differs from Bob’s secret.'
				: 'INTEGRITY ERROR — Eve exhausted the transcript without finding Bob’s index.';
		}
	}

	async function runFallback(payload: EvePayload, currentRun: number): Promise<void> {
		const fallbackPayload = { ...payload, cap: Math.min(payload.cap, FALLBACK_CAP) };
		try {
			const result = await eveBruteForce(fallbackPayload, {
				isCancelled: () => currentRun !== runId,
				onProgress(progress) {
					if (currentRun !== runId) return;
					setMeter('eve', progress.operations, expectedEveTrials(payload.transcript.puzzles.length, payload.b));
				},
			});
			finishEve(result, true, currentRun);
		} catch (error) {
			if (currentRun !== runId) return;
			runId += 1;
			cancelButton.disabled = true;
			eveButton.disabled = !bob;
			eveVerdict.textContent = `Fallback error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	function runEve(): void {
		if (!alice || !bob) return;
		cancelEve();
		const currentRun = runId;
		const payload = makeEvePayload(alice.puzzles, bob.index, alice.b, EVE_CAP);
		const prediction = expectedEveTrials(alice.count, alice.b);
		function startFallback(): void {
			if (currentRun !== runId) return;
			worker?.terminate();
			worker = undefined;
			// Retire this worker's lease before starting the fallback; a late
			// worker event cannot complete or overwrite the fallback either.
			runId += 1;
			status.textContent = `Worker unavailable; running a labelled main-thread fallback capped at ${formatCount(FALLBACK_CAP)} trials.`;
			void runFallback(payload, runId);
		}
		eveRecovered = false;
		renderAgreement();
		eveButton.disabled = true;
		cancelButton.disabled = false;
		eveVerdict.removeAttribute('data-verdict');
		eveVerdict.className = 'puzzle-verdict';
		eveVerdict.textContent = 'Eve is trying the public transcript…';
		setMeter('eve', 0, prediction);
		status.textContent = 'Eve is running in a worker. You can cancel without losing Alice and Bob’s result.';
		try {
			worker = new Worker(new URL('./eve.worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = (event: MessageEvent<EveWorkerMessage>) => {
				const message = event.data;
				if (currentRun !== runId || message.runId !== currentRun) return;
				if (message.type === 'progress') {
					setMeter('eve', message.progress.operations, prediction);
					status.textContent = `Eve: ${formatCount(message.progress.operations)} AES trials across ${formatCount(message.progress.puzzlesTried)} puzzles…`;
				} else if (message.type === 'result') {
					worker?.terminate();
					finishEve(message.result, false, currentRun);
				} else {
					worker?.terminate();
					worker = undefined;
					runId += 1;
					cancelButton.disabled = true;
					eveButton.disabled = false;
					eveVerdict.textContent = `Worker error: ${message.message}`;
				}
			};
			worker.onerror = (event) => {
				event.preventDefault();
				startFallback();
			};
			worker.postMessage({ type: 'run', runId: currentRun, payload });
		} catch {
			startFallback();
		}
	}

	buildButton.addEventListener('click', build);
	bobButton.addEventListener('click', solveBob);
	eveButton.addEventListener('click', runEve);
	cancelButton.addEventListener('click', () => {
		cancelEve();
		eveRecovered = false;
		renderAgreement();
		eveVerdict.dataset.verdict = 'puzzle-eve';
		eveVerdict.className = 'puzzle-verdict puzzle-verdict--alarm';
		eveVerdict.textContent = 'INCOMPLETE — Eve’s run was cancelled; no recovery is claimed.';
		status.textContent = 'Eve’s run was cancelled. Alice and Bob’s result remains current.';
	});
	corruptButton.addEventListener('click', () => {
		if (!bob) return;
		cancelEve();
		eveVerdict.removeAttribute('data-verdict');
		eveVerdict.className = 'puzzle-verdict';
		eveVerdict.textContent = 'Eve’s previous result was retired: Bob’s displayed copy changed.';
		setMeter('eve', undefined, alice ? expectedEveTrials(alice.count, alice.b) : 0);
		displayedBobSecret = bob.secret.slice();
		displayedBobSecret[0] = displayedBobSecret[0]! ^ 0x01;
		eveRecovered = false;
		renderAgreement();
		status.textContent = 'Bob’s displayed copy was changed by one bit; the byte comparison now rejects it.';
	});

	// Build the safe default once so the mechanism, table comparison, and work
	// prediction are present without requiring a setup click.
	queueMicrotask(build);
	return section;
}
