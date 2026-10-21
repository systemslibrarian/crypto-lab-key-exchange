import assert from 'node:assert/strict';
import test from 'node:test';

import { dec, enc, equalBytes, fromHex, toHex } from '../src/merkle/aes.ts';
import { eveBruteForce, makeEvePayload } from '../src/merkle/eve-core.ts';
import { aliceLookup, bobSolve, buildPuzzles, PuzzleIntegrityError } from '../src/merkle/protocol.ts';
import { saltedTableAttempt, tableAttack } from '../src/merkle/textbook-form.ts';
import { expectedEveTrials, meanTolerance } from '../src/merkle/work.ts';

function seededRandom(seed) {
	let state = seed >>> 0;
	function next() {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	}
	return {
		bytes(length) {
			const out = new Uint8Array(length);
			for (let i = 0; i < length; i += 1) out[i] = next() & 0xff;
			return out;
		},
		integer(maxExclusive) {
			return next() % maxExclusive;
		},
	};
}

test('FIPS 197-upd1 Appendix B AES-128 cipher example', () => {
	const key = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
	const plaintext = fromHex('3243f6a8885a308d313198a2e0370734');
	const ciphertext = fromHex('3925841d02dc09fbdc118597196a0b32');
	assert.equal(toHex(enc(key, plaintext)), toHex(ciphertext));
	assert.equal(toHex(dec(key, ciphertext)), toHex(plaintext));
});

test('NIST SP 800-38A F.1.1 AES-128 ECB — all four published blocks', () => {
	const key = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
	const vectors = [
		['6bc1bee22e409f96e93d7e117393172a', '3ad77bb40d7a3660a89ecaf32466ef97'],
		['ae2d8a571e03ac9c9eb76fac45af8e51', 'f5d3d58503b9699de785895a96fdbaaf'],
		['30c81c46a35ce411e5fbc1191a0a52ef', '43b1cd7f598ece23881b00e3ed030688'],
		['f69f2445df4f9b17ad2b417be66c3710', '7b0c785e27e8ad3f8223207104725dd4'],
	];
	for (const [plainHex, cipherHex] of vectors) {
		assert.equal(toHex(enc(key, fromHex(plainHex))), cipherHex);
		assert.equal(toHex(dec(key, fromHex(cipherHex))), plainHex);
	}
});

test('required pre-UI reproduction: one 2^10 table solves 1,024/1,024 textbook puzzles', () => {
	const state = buildPuzzles(2 ** 10, 10, 'textbook');
	const target = 517;
	const result = tableAttack(state.puzzles, state.b, target);
	assert.equal(result.tableOps, 2 ** 10);
	assert.equal(result.solved, 2 ** 10);
	assert.ok(result.secret);
	assert.ok(equalBytes(result.secret, aliceLookup(state, target)));
});

test('Bob opens one independent puzzle and Alice finds the same 128-bit secret', () => {
	const state = buildPuzzles(2 ** 8, 8, 'salted');
	const bob = bobSolve(state.puzzles, state.b, { puzzlePosition: 17 });
	assert.equal(bob.matchingKeys, 1);
	assert.ok(equalBytes(bob.secret, aliceLookup(state, bob.index)));
});

test('Alice and Bob agree over 100 salted runs', () => {
	for (let run = 1; run <= 100; run += 1) {
		const random = seededRandom(0x9e3779b9 ^ run);
		const state = buildPuzzles(2 ** 8, 8, 'salted', { random });
		const bob = bobSolve(state.puzzles, state.b, { random });
		assert.ok(equalBytes(bob.secret, aliceLookup(state, bob.index)), `run ${run}`);
		assert.equal(bob.matchingKeys, 1);
	}
});

test('the textbook-form table solves every puzzle; the same table matches no salted puzzle', () => {
	const textbook = buildPuzzles(2 ** 8, 8, 'textbook', { random: seededRandom(11) });
	assert.equal(tableAttack(textbook.puzzles, 8, 42).solved, 2 ** 8);
	const salted = buildPuzzles(2 ** 8, 8, 'salted', { random: seededRandom(12) });
	assert.equal(saltedTableAttempt(salted.puzzles, 8).matches, 0);
});

test('Bob fails closed and asks for a restart when two keys pass the check', () => {
	const toyCipher = {
		enc(_key, block) { return block.slice(); },
		dec(_key, block) { return block.slice(); },
	};
	const state = buildPuzzles(2 ** 8, 8, 'salted', {
		random: seededRandom(99),
		cipher: toyCipher,
	});
	assert.throws(
		() => bobSolve(state.puzzles, 8, { puzzlePosition: 0, cipher: toyCipher }),
		(error) => error instanceof PuzzleIntegrityError && error.reason === 'ambiguous-key',
	);
});

test('Eve receives transcript fields only — never weak suffixes, secrets, or Bob’s choice', () => {
	const state = buildPuzzles(2 ** 8, 8, 'salted', { random: seededRandom(123) });
	const bob = bobSolve(state.puzzles, 8, { puzzlePosition: 3 });
	const payload = makeEvePayload(state.puzzles, bob.index, 8, 2 ** 24);
	assert.deepEqual(Object.keys(payload).sort(), ['b', 'cap', 'transcript']);
	assert.deepEqual(Object.keys(payload.transcript).sort(), ['puzzles', 'targetIndex']);
	assert.deepEqual(Object.keys(payload.transcript.puzzles[0]).sort(), ['c1', 'c2', 'c3', 'prefix']);
	assert.equal('u' in payload, false);
	assert.equal('s' in payload, false);
	assert.equal('bobChoice' in payload, false);
	assert.equal('puzzlePosition' in payload.transcript, false);
});

test('Eve’s toy-run mean falls within a tolerance derived from independent search-cost variance', async () => {
	const samples = 32;
	const observations = [];
	for (let run = 0; run < samples; run += 1) {
		const random = seededRandom(0xa5a5a5a5 ^ run);
		const state = buildPuzzles(2 ** 8, 8, 'salted', { random });
		const bob = bobSolve(state.puzzles, 8, { random });
		const result = await eveBruteForce(
			makeEvePayload(state.puzzles, bob.index, 8, 2 ** 24),
			{ random, yieldEvery: Number.MAX_SAFE_INTEGER },
		);
		assert.equal(result.status, 'recovered');
		assert.ok(result.status === 'recovered' && equalBytes(result.secret, bob.secret));
		observations.push(result.operations);
	}
	const measured = observations.reduce((sum, value) => sum + value, 0) / samples;
	const predicted = expectedEveTrials(2 ** 8, 8);
	const tolerance = meanTolerance(2 ** 8, 8, samples);
	assert.ok(Math.abs(measured - predicted) <= tolerance, { measured, predicted, tolerance });
});

test('Alice’s operation count is exactly three AES encryptions per puzzle', () => {
	const state = buildPuzzles(333, 9, 'salted', { random: seededRandom(8080) });
	assert.equal(state.aliceOps, 3 * 333);
});

test('out-of-range b and L are refused with their named ranges', () => {
	assert.throws(() => buildPuzzles(2 ** 8, 7), /8 through 14/);
	assert.throws(() => buildPuzzles(2 ** 8, 15), /8 through 14/);
	assert.throws(() => buildPuzzles(255, 10), /2\^8 through 2\^12/);
	assert.throws(() => buildPuzzles(4097, 10), /2\^8 through 2\^12/);
});

test('Eve stops exactly at the live cap and reports incomplete', async () => {
	const random = seededRandom(404);
	const state = buildPuzzles(2 ** 8, 8, 'salted', { random });
	const result = await eveBruteForce(makeEvePayload(state.puzzles, 17, 8, 7), {
		random,
		yieldEvery: Number.MAX_SAFE_INTEGER,
	});
	assert.equal(result.status, 'incomplete');
	assert.equal(result.operations, 7);
});

test('Eve cancellation returns incomplete without consuming a hidden input', async () => {
	const random = seededRandom(405);
	const state = buildPuzzles(2 ** 8, 8, 'salted', { random });
	const result = await eveBruteForce(makeEvePayload(state.puzzles, 17, 8, 99), {
		random,
		isCancelled: () => true,
	});
	assert.equal(result.status, 'incomplete');
	assert.equal(result.operations, 0);
});
