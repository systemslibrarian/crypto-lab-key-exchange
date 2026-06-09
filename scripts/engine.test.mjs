// Deterministic unit tests for src/engine.ts.
//
// Runs under Node 22+'s built-in test runner with --experimental-strip-types
// so we can import .ts directly. All assertions are deterministic — the
// random-output APIs (mlkemEncapsulateDemo, hybridCombine over real
// secrets) are tested for shape, not for specific output bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	DEMO_CURVE,
	INFINITY,
	diffieHellman,
	discreteLogAttack,
	ecAdd,
	ecMul,
	ecdh,
	hybridCombine,
	isOnCurve,
	mlkemEncapsulateDemo,
	modInverse,
	modPow,
	pointToString,
} from '../src/engine.ts';

test('modPow: known values', () => {
	assert.equal(modPow(5, 0, 23), 1);
	assert.equal(modPow(5, 6, 23), 8);
	assert.equal(modPow(5, 15, 23), 19);
	assert.equal(modPow(2, 10, 1024), 0); // 1024 = 2^10
	assert.equal(modPow(7, 100, 13), modPow(7, 100, 13)); // determinism
});

test('modPow: identity edge cases', () => {
	assert.equal(modPow(0, 0, 7), 1); // by convention here
	assert.equal(modPow(123, 1, 7), 123 % 7);
	assert.equal(modPow(99, 5, 1), 0);
});

test('modInverse: matches a * a^-1 = 1 mod p', () => {
	for (const p of [7, 11, 13, 17, 23]) {
		for (let a = 1; a < p; a++) {
			const inv = modInverse(a, p);
			assert.equal((a * inv) % p, 1, `a=${a}, p=${p}: ${a}*${inv} mod ${p} should be 1`);
		}
	}
});

test('diffieHellman: classic textbook example agrees', () => {
	// Hellman & Diffie's own paper uses small examples; we use 23/5/6/15.
	const r = diffieHellman(23, 5, 6, 15);
	assert.equal(r.A, 8);
	assert.equal(r.B, 19);
	assert.equal(r.sharedFromAlice, 2);
	assert.equal(r.sharedFromBob, 2);
	assert.equal(r.agree, true);
});

test('diffieHellman: many random instances all agree', () => {
	const primes = [7, 11, 13, 17, 19, 23, 29, 31, 97, 257];
	for (const p of primes) {
		// 2 is a primitive root for many of these; even when it isn't,
		// agreement (not full coverage) is what we're testing.
		for (let trial = 0; trial < 8; trial++) {
			const a = 1 + Math.floor(Math.random() * (p - 1));
			const b = 1 + Math.floor(Math.random() * (p - 1));
			const r = diffieHellman(p, 2, a, b);
			assert.equal(r.agree, true, `agreement failed at p=${p}, a=${a}, b=${b}`);
			assert.equal(r.sharedFromAlice, r.sharedFromBob);
		}
	}
});

test('discreteLogAttack: recovers known exponent', () => {
	const dh = diffieHellman(23, 5, 6, 15);
	const recovered = discreteLogAttack(5, dh.A, 23);
	assert.equal(recovered, 6);
});

test('discreteLogAttack: works across small primes', () => {
	const primes = [7, 11, 13, 17, 19, 23];
	for (const p of primes) {
		for (let a = 1; a < p; a++) {
			const A = modPow(2, a, p);
			const x = discreteLogAttack(2, A, p);
			// Either we recovered exactly a, or we recovered the smallest
			// x in [1, p-1] with 2^x ≡ A (mod p). Either way 2^x mod p must equal A.
			assert.notEqual(x, null, `attack returned null for p=${p}, a=${a}`);
			assert.equal(modPow(2, x ?? 0, p), A);
		}
	}
});

test('isOnCurve: demo generator (5, 1) is on the curve', () => {
	assert.equal(isOnCurve(DEMO_CURVE.G, DEMO_CURVE), true);
});

test('isOnCurve: rejects a non-curve point', () => {
	assert.equal(isOnCurve({ x: 5, y: 2 }, DEMO_CURVE), false);
	assert.equal(isOnCurve({ x: 0, y: 0 }, DEMO_CURVE), false);
});

test('isOnCurve: point at infinity is on the curve', () => {
	assert.equal(isOnCurve(INFINITY, DEMO_CURVE), true);
});

test('ecAdd: doubling the generator matches hand-computed (6, 3)', () => {
	const twoG = ecAdd(DEMO_CURVE.G, DEMO_CURVE.G, DEMO_CURVE);
	assert.equal(twoG.x, 6);
	assert.equal(twoG.y, 3);
	assert.equal(isOnCurve(twoG, DEMO_CURVE), true);
});

test('ecMul: 1·G = G and 0·G = ∞', () => {
	const oneG = ecMul(1, DEMO_CURVE.G, DEMO_CURVE);
	assert.equal(oneG.x, DEMO_CURVE.G.x);
	assert.equal(oneG.y, DEMO_CURVE.G.y);
	const zeroG = ecMul(0, DEMO_CURVE.G, DEMO_CURVE);
	assert.equal(zeroG.infinity, true);
});

test('ecMul: scalar mult agrees with iterated addition', () => {
	let acc = DEMO_CURVE.G;
	for (let k = 2; k < DEMO_CURVE.n; k++) {
		acc = ecAdd(acc, DEMO_CURVE.G, DEMO_CURVE);
		const fast = ecMul(k, DEMO_CURVE.G, DEMO_CURVE);
		assert.equal(acc.x, fast.x, `k=${k} x mismatch`);
		assert.equal(acc.y, fast.y, `k=${k} y mismatch`);
	}
});

test('ecMul: n·G = ∞', () => {
	const nG = ecMul(DEMO_CURVE.n, DEMO_CURVE.G, DEMO_CURVE);
	assert.equal(nG.infinity, true, `${DEMO_CURVE.n}·G should be infinity`);
});

test('ecdh: both ends agree on demo curve', () => {
	for (let a = 1; a < DEMO_CURVE.n; a++) {
		for (let b = 1; b < DEMO_CURVE.n; b++) {
			const r = ecdh(DEMO_CURVE, a, b);
			assert.equal(r.agree, true, `ECDH disagreed at a=${a}, b=${b}`);
		}
	}
});

test('pointToString: infinity and finite formatting', () => {
	assert.equal(pointToString(INFINITY), 'O (point at infinity)');
	assert.equal(pointToString({ x: 5, y: 1 }), '(5, 1)');
});

test('mlkemEncapsulateDemo: shape, hex length, internal consistency', async () => {
	const r = await mlkemEncapsulateDemo();
	assert.equal(r.bobSecret.length, 64); // 32 bytes hex
	assert.equal(r.aliceSecret.length, 64);
	assert.equal(r.ciphertext.length, 96); // 48 bytes hex
	assert.equal(r.bobSecret, r.aliceSecret, 'demo flow should agree');
	assert.equal(r.agree, true);
	assert.match(r.bobSecret, /^[0-9a-f]+$/);
});

test('hybridCombine: deterministic for fixed inputs, 64-hex-char output', async () => {
	const a = await hybridCombine(2, 'aa'.repeat(32));
	const b = await hybridCombine(2, 'aa'.repeat(32));
	assert.equal(a.length, 64); // SHA-256 = 32 bytes
	assert.equal(a, b, 'hybrid combine must be deterministic');
	assert.match(a, /^[0-9a-f]+$/);
});

test('hybridCombine: different inputs produce different outputs', async () => {
	const a = await hybridCombine(2, 'aa'.repeat(32));
	const b = await hybridCombine(3, 'aa'.repeat(32));
	const c = await hybridCombine(2, 'bb'.repeat(32));
	assert.notEqual(a, b);
	assert.notEqual(a, c);
});
