// A deliberately small numeric-comparison model next to the real DH relay.
// Bluetooth LE Secure Connections uses different cryptographic functions and
// a six-digit display. The three-digit toy makes Eve's adaptive search visible.

export type PairingScenario = 'honest' | 'adaptive' | 'committed';

export interface PairingResult {
	scenario: PairingScenario;
	aliceCode: string;
	bobCode: string;
	initialAliceCode: string;
	searchTrials: number;
	initialEveNonce: number;
	revealedEveNonce: number;
	commitmentHex: string | null;
	commitmentValid: boolean | null;
	aborted: boolean;
	sharesSubstituted: boolean;
}

const ALICE_KEY = 'Alice key';
const BOB_KEY = 'Bob key';
const EVE_TO_ALICE_KEY = 'Eve key A';
const EVE_TO_BOB_KEY = 'Eve key B';
const ALICE_NONCE = 41;
const BOB_NONCE = 73;
const EVE_TO_BOB_NONCE = 203;
const EVE_INITIAL_NONCE = 0;

/** Toy 3-digit display over both public shares and both fresh nonces. */
export function toyComparisonCode(
	firstKey: string,
	secondKey: string,
	firstNonce: number,
	secondNonce: number,
): string {
	const transcript = JSON.stringify([firstKey, secondKey, firstNonce, secondNonce]);
	let hash = 0x811c9dc5;
	for (const character of transcript) {
		hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
	}
	return String(hash % 1000).padStart(3, '0');
}

/** A real SHA-256 commitment binds the toy public-key pair and nonce. */
export async function pairingCommitment(
	firstKey: string,
	secondKey: string,
	nonce: number,
): Promise<string> {
	const input = new TextEncoder().encode(JSON.stringify([firstKey, secondKey, nonce]));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Replay one fixed set of roles, changing only Eve's freedom to choose late. */
export async function simulateNumericComparison(scenario: PairingScenario): Promise<PairingResult> {
	if (scenario === 'honest') {
		const commitmentHex = await pairingCommitment(ALICE_KEY, BOB_KEY, BOB_NONCE);
		const code = toyComparisonCode(ALICE_KEY, BOB_KEY, ALICE_NONCE, BOB_NONCE);
		return {
			scenario,
			aliceCode: code,
			bobCode: code,
			initialAliceCode: code,
			searchTrials: 0,
			initialEveNonce: EVE_INITIAL_NONCE,
			revealedEveNonce: EVE_INITIAL_NONCE,
			commitmentHex,
			commitmentValid: commitmentHex === await pairingCommitment(ALICE_KEY, BOB_KEY, BOB_NONCE),
			aborted: false,
			sharesSubstituted: false,
		};
	}

	const bobCode = toyComparisonCode(EVE_TO_BOB_KEY, BOB_KEY, EVE_TO_BOB_NONCE, BOB_NONCE);
	const initialAliceCode = toyComparisonCode(ALICE_KEY, EVE_TO_ALICE_KEY, ALICE_NONCE, EVE_INITIAL_NONCE);
	let revealedEveNonce = -1;
	let searchTrials = 0;
	// Eve sees the honest nonce first, then tries candidate values on her Alice
	// leg. With a real six-digit display, this small bounded search would not
	// reliably succeed; this is a three-digit teaching transcript.
	for (let candidate = 1; candidate <= 10_000; candidate++) {
		searchTrials++;
		if (toyComparisonCode(ALICE_KEY, EVE_TO_ALICE_KEY, ALICE_NONCE, candidate) === bobCode) {
			revealedEveNonce = candidate;
			break;
		}
	}
	if (revealedEveNonce < 0) throw new Error('No matching toy code found in search window');

	const aliceCode = toyComparisonCode(ALICE_KEY, EVE_TO_ALICE_KEY, ALICE_NONCE, revealedEveNonce);
	const commitmentHex = scenario === 'committed'
		? await pairingCommitment(ALICE_KEY, EVE_TO_ALICE_KEY, EVE_INITIAL_NONCE)
		: null;
	const commitmentValid = commitmentHex === null
		? null
		: commitmentHex === await pairingCommitment(ALICE_KEY, EVE_TO_ALICE_KEY, revealedEveNonce);

	return {
		scenario,
		aliceCode,
		bobCode,
		initialAliceCode,
		searchTrials,
		initialEveNonce: EVE_INITIAL_NONCE,
		revealedEveNonce,
		commitmentHex,
		commitmentValid,
		aborted: commitmentValid === false,
		sharesSubstituted: true,
	};
}
