import assert from 'node:assert/strict';
import test from 'node:test';
import { dec, enc, equalBytes } from '../src/merkle/aes.ts';
import { aliceLookup, bobSolve, buildPuzzles } from '../src/merkle/protocol.ts';
import { eveBruteForce, makeEvePayload } from '../src/merkle/eve-core.ts';
import { eveTrialVariance, expectedEveTrials } from '../src/merkle/work.ts';

test('public index ciphertexts never equal the zero-check ciphertext', () => {
	for (const mode of ['salted', 'textbook']) {
		const state = buildPuzzles(256, 8, mode);
		assert.equal(state.puzzles.filter((p) => equalBytes(p.cIndex, p.cCheck)).length, 0,
			'index zero otherwise identifies one shuffled puzzle without any AES work');
		const indices = new Set();
		for (let position = 0; position < state.count; position++) {
			const bob = bobSolve(state.puzzles, 8, { puzzlePosition: position });
			assert.ok(bob.index >= 1 && bob.index <= state.count);
			assert.ok(equalBytes(bob.secret, aliceLookup(state, bob.index)));
			indices.add(bob.index);
		}
		assert.equal(indices.size, state.count);
		assert.throws(() => aliceLookup(state, 0), /outside/);
	}
});

test('Eve variance matches exhaustive independent puzzle-cost distributions', () => {
	// Enumerate every search cost for a tiny model, weighted by its actual
	// probability. This does not use the implementation's moment formula.
	for (const count of [2, 3, 4]) {
		const keySpace = 4;
		let mean = 0;
		let secondMoment = 0;
		let distribution = [1];
		for (let solved = 1; solved <= count; solved++) {
			const next = Array(distribution.length + keySpace).fill(0);
			for (let sum = 0; sum < distribution.length; sum++) {
				for (let cost = 1; cost <= keySpace; cost++) next[sum + cost] += distribution[sum];
			}
			distribution = next;
			for (let total = 0; total < distribution.length; total++) {
				const probability = distribution[total] / (count * keySpace ** solved);
				mean += probability * total;
				secondMoment += probability * total ** 2;
			}
		}
		assert.ok(Math.abs(mean - expectedEveTrials(count, 2)) < 1e-10);
		assert.ok(Math.abs(secondMoment - mean ** 2 - eveTrialVariance(count, 2)) < 1e-10);
	}
});

test('every reported AES counter accounts for actual instrumented cipher calls', async () => {
	let encryptions = 0;
	let decryptions = 0;
	const cipher = {
		enc(key, block) { encryptions++; return enc(key, block); },
		dec(key, block) { decryptions++; return dec(key, block); },
	};
	const state = buildPuzzles(256, 8, 'salted', { cipher });
	assert.equal(state.aliceOps, encryptions);
	const bob = bobSolve(state.puzzles, 8, { cipher });
	assert.equal(bob.auxiliaryOps, 2);
	assert.equal(bob.trials + bob.auditOps + bob.auxiliaryOps, decryptions);
	decryptions = 0;
	const payload = makeEvePayload(state.puzzles, bob.index, 8, 2 ** 24);
	const markerBlocks = new Set(payload.transcript.puzzles.map((p) => p.c3));
	let markerDecryptions = 0;
	const result = await eveBruteForce(payload, { cipher: {
		enc,
		dec(key, block) { if (markerBlocks.has(block)) markerDecryptions++; return cipher.dec(key, block); },
	}, yieldEvery: Number.MAX_SAFE_INTEGER });
	assert.equal(result.status, 'recovered');
	assert.equal(result.operations, markerDecryptions);
	assert.equal(result.operations + result.auxiliaryOps, decryptions);
});

test('cancelling active Eve work performs no more AES calls after the next yield', async () => {
	const state = buildPuzzles(256, 8);
	const bob = bobSolve(state.puzzles, 8, { puzzlePosition: 255 });
	let calls = 0;
	let stoppedAt;
	let cancelled = false;
	const result = await eveBruteForce(makeEvePayload(state.puzzles, bob.index, 8, 2 ** 24), {
		// Identity order puts Bob's target last, so work reaches the cancellation
		// point deterministically without changing any AES inputs or keys.
		random: { integer: (n) => n - 1, bytes: (n) => new Uint8Array(n) },
		cipher: { enc, dec(key, block) { calls++; return dec(key, block); } },
		yieldEvery: 64,
		isCancelled: () => cancelled,
		onProgress(progress) {
			if (progress.operations >= 64) { cancelled = true; stoppedAt = calls; }
		},
	});
	assert.equal(result.status, 'incomplete');
	assert.ok(result.operations >= 64);
	assert.equal(calls, stoppedAt);
});
