import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	pairingCommitment,
	simulateNumericComparison,
	toyComparisonCode,
} from '../src/pairing.ts';

test('honest transcript has a matching code and a valid commitment', async () => {
	const run = await simulateNumericComparison('honest');
	assert.equal(run.aliceCode, run.bobCode);
	assert.equal(run.commitmentValid, true);
	assert.equal(run.aborted, false);
	assert.equal(run.sharesSubstituted, false);
});

test('without an early commitment Eve can choose her nonce after seeing the target code', async () => {
	const run = await simulateNumericComparison('adaptive');
	assert.equal(run.sharesSubstituted, true);
	assert.equal(run.commitmentValid, null);
	assert.equal(run.aborted, false);
	assert.notEqual(run.initialAliceCode, run.bobCode);
	assert.equal(run.aliceCode, run.bobCode);
	assert.ok(run.searchTrials > 0 && run.searchTrials <= 10_000);
	assert.equal(run.revealedEveNonce, run.searchTrials);
});

test('the exact same late choice fails a commitment made before Alice revealed her nonce', async () => {
	const adaptive = await simulateNumericComparison('adaptive');
	const committed = await simulateNumericComparison('committed');
	assert.equal(committed.revealedEveNonce, adaptive.revealedEveNonce);
	assert.equal(committed.aliceCode, committed.bobCode);
	assert.equal(committed.commitmentValid, false);
	assert.equal(committed.aborted, true);
	assert.notEqual(committed.initialAliceCode, committed.bobCode);
	assert.notEqual(committed.revealedEveNonce, committed.initialEveNonce);
});

test('commitment binds both public shares and the nonce using SHA-256', async () => {
	const expected = createHash('sha256')
		.update(JSON.stringify(['Alice key', 'Bob key', 73]))
		.digest('hex');
	assert.equal(await pairingCommitment('Alice key', 'Bob key', 73), expected);
	assert.notEqual(await pairingCommitment('Alice key', 'Bob key', 74), expected);
	assert.notEqual(await pairingCommitment('Alice key', 'Eve key', 73), expected);
});

test('display function includes both public shares and both nonces', () => {
	const original = toyComparisonCode('A', 'B', 41, 73);
	for (const changed of [
		toyComparisonCode('E', 'B', 41, 73),
		toyComparisonCode('A', 'E', 41, 73),
		toyComparisonCode('A', 'B', 42, 73),
		toyComparisonCode('A', 'B', 41, 74),
	]) assert.notEqual(changed, original);
});
