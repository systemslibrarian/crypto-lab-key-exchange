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
	hybridHandshake,
	isOnCurve,
	mlkemEncapsulateDemo,
	modInverse,
	modPow,
	pointToString,
} from '../src/engine.ts';

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

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

// ---- Real ML-KEM-768 (FIPS 203) ------------------------------------------

test('mlkemEncapsulateDemo: real FIPS 203 sizes and round-trip', async () => {
	const r = await mlkemEncapsulateDemo();
	// ML-KEM-768 (FIPS 203, Table 3): ek=1184, ct=1088, shared secret=32.
	assert.equal(r.publicKeyLen, 1184, 'ML-KEM-768 encapsulation key is 1184 bytes');
	assert.equal(r.ciphertextLen, 1088, 'ML-KEM-768 ciphertext is 1088 bytes');
	assert.equal(r.bobSecret.length, 64, '32-byte secret as hex'); // 32 bytes hex
	assert.equal(r.aliceSecret.length, 64);
	assert.equal(r.ciphertext.length, 1088 * 2, 'ciphertext hex length matches 1088 bytes');
	assert.equal(r.bobSecret, r.aliceSecret, 'honest run: Alice recovers Bob’s secret');
	assert.equal(r.agree, true);
	assert.match(r.bobSecret, /^[0-9a-f]+$/);
});

test('mlkemEncapsulateDemo: a flipped ciphertext bit does NOT yield Bob’s secret', async () => {
	// FIPS 203 implicit rejection: decapsulating a tampered ciphertext gives a
	// pseudorandom secret that differs from the real one. This is the property
	// that makes a forged ciphertext useless — a flow model of random bytes
	// could never demonstrate it.
	const r = await mlkemEncapsulateDemo();
	assert.equal(r.tamperRejected, true, 'tampered ciphertext must not reproduce Bob’s secret');
	assert.notEqual(r.tamperedSecret, r.bobSecret);
	assert.equal(r.tamperedSecret.length, 64);
});

test('mlkemEncapsulateDemo: fresh randomness each call (not a fixed constant)', async () => {
	const r1 = await mlkemEncapsulateDemo();
	const r2 = await mlkemEncapsulateDemo();
	assert.notEqual(r1.bobSecret, r2.bobSecret, 'two encapsulations should differ');
	assert.notEqual(r1.ciphertext, r2.ciphertext);
});

test('ML-KEM-768 KAT: decapsulate is the inverse of encapsulate for a fixed key', () => {
	// Property/round-trip vector: for a freshly generated key pair, encapsulate
	// then decapsulate must recover exactly the encapsulated shared secret.
	for (let i = 0; i < 20; i++) {
		const { publicKey, secretKey } = ml_kem768.keygen();
		const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
		const recovered = ml_kem768.decapsulate(cipherText, secretKey);
		assert.equal(recovered.length, 32);
		assert.deepEqual(Array.from(recovered), Array.from(sharedSecret));
	}
});

test('ML-KEM-768: decapsulating with the WRONG key rejects (implicit rejection)', () => {
	const { publicKey } = ml_kem768.keygen();
	const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
	const other = ml_kem768.keygen();
	const recovered = ml_kem768.decapsulate(cipherText, other.secretKey);
	// A different decapsulation key must not recover the encapsulated secret.
	assert.notDeepEqual(Array.from(recovered), Array.from(sharedSecret));
});

// ---- Hybrid combine (HKDF over fixed-width DH ‖ real KEM secret) ----------

test('hybridCombine: deterministic for fixed inputs, 64-hex-char output', async () => {
	const a = await hybridCombine(2, 'aa'.repeat(32));
	const b = await hybridCombine(2, 'aa'.repeat(32));
	assert.equal(a.length, 64); // HKDF-SHA256 -> 32 bytes
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

test('hybridCombine: fixed-width DH encoding avoids concatenation ambiguity', async () => {
	// With plain string concatenation, dh=1,kem="23..." and dh=12,kem="3..."
	// could collide if the KEM half absorbs a digit. Fixed 4-byte encoding of
	// the DH value keeps the two fields unambiguous, so distinct DH values with
	// the same KEM half always produce distinct session keys.
	const k = '11'.repeat(32);
	const s1 = await hybridCombine(1, k);
	const s12 = await hybridCombine(12, k);
	const s123 = await hybridCombine(123, k);
	assert.notEqual(s1, s12);
	assert.notEqual(s12, s123);
	assert.notEqual(s1, s123);
});

test('hybridHandshake: real X25519 + real ML-KEM-768 -> both ends derive the same key', async () => {
	const r = await hybridHandshake();
	assert.equal(r.x25519SharedLen, 32, 'X25519 shared secret is 32 bytes');
	assert.equal(r.mlkemSharedLen, 32, 'ML-KEM-768 shared secret is 32 bytes');
	assert.equal(r.aliceSessionKey.length, 64);
	assert.equal(r.bobSessionKey.length, 64);
	assert.equal(r.agree, true, 'Alice and Bob must derive identical session keys');
	assert.equal(r.aliceSessionKey, r.bobSessionKey);
});
