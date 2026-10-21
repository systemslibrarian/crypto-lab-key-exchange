import {
	AES_BLOCK_CIPHER,
	BLOCK_BYTES,
	ZERO_BLOCK,
	equalBytes,
	makeKey,
	type BlockCipher,
} from './aes.ts';
import { textbookPrefix } from './textbook-form.ts';

export type PuzzleMode = 'salted' | 'textbook';

export interface Puzzle {
	prefix: Uint8Array;
	cSecret: Uint8Array;
	cIndex: Uint8Array;
	cCheck: Uint8Array;
}

export interface AliceState {
	b: number;
	count: number;
	mode: PuzzleMode;
	puzzles: Puzzle[];
	secrets: Uint8Array[];
	aliceOps: number;
}

export interface RandomSource {
	bytes(length: number): Uint8Array;
	integer(maxExclusive: number): number;
}

export interface BobResult {
	index: number;
	secret: Uint8Array;
	trials: number;
	auditOps: number;
	matchingKeys: number;
	puzzlePosition: number;
}

export class PuzzleIntegrityError extends Error {
	readonly reason: 'no-key' | 'ambiguous-key' | 'bad-index';

	constructor(reason: PuzzleIntegrityError['reason'], message: string) {
		super(message);
		this.name = 'PuzzleIntegrityError';
		this.reason = reason;
	}
}

export const SECURE_RANDOM: RandomSource = {
	bytes(length) {
		if (!Number.isInteger(length) || length < 0) throw new RangeError('length must be non-negative');
		return crypto.getRandomValues(new Uint8Array(length));
	},
	integer(maxExclusive) {
		if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000) {
			throw new RangeError('maxExclusive must be an integer from 1 through 2^32');
		}
		const range = 0x1_0000_0000;
		const limit = range - (range % maxExclusive);
		const word = new Uint32Array(1);
		do crypto.getRandomValues(word);
		while (word[0]! >= limit);
		return word[0]! % maxExclusive;
	},
};

function validateParameters(count: number, b: number): void {
	if (!Number.isInteger(b) || b < 8 || b > 14) throw new RangeError('b must be an integer from 8 through 14');
	if (!Number.isInteger(count) || count < 2 ** 8 || count > 2 ** 12) {
		throw new RangeError('L must be an integer from 2^8 through 2^12');
	}
}

function clearSuffix(prefix: Uint8Array, b: number): Uint8Array {
	const out = prefix.slice();
	for (let bit = 0; bit < b; bit += 1) {
		const byteIndex = BLOCK_BYTES - 1 - Math.floor(bit / 8);
		out[byteIndex] = out[byteIndex]! & ~(1 << (bit % 8));
	}
	return out;
}

function encodeIndex(index: number): Uint8Array {
	const out = new Uint8Array(BLOCK_BYTES);
	new DataView(out.buffer).setUint32(12, index, false);
	return out;
}

function decodeIndex(block: Uint8Array, count: number): number {
	if (block.length !== BLOCK_BYTES) throw new PuzzleIntegrityError('bad-index', 'decrypted index is not one block');
	for (let i = 0; i < 12; i += 1) {
		if (block[i] !== 0) throw new PuzzleIntegrityError('bad-index', 'decrypted index has a non-zero prefix');
	}
	const index = new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(12, false);
	if (index >= count) throw new PuzzleIntegrityError('bad-index', 'decrypted index is outside Alice’s puzzle list');
	return index;
}

function shuffle<T>(values: T[], random: RandomSource): void {
	for (let i = values.length - 1; i > 0; i -= 1) {
		const j = random.integer(i + 1);
		[values[i], values[j]] = [values[j]!, values[i]!];
	}
}

export interface ProtocolOptions {
	random?: RandomSource;
	cipher?: BlockCipher;
}

export function buildPuzzles(
	count: number,
	b: number,
	mode: PuzzleMode = 'salted',
	options: ProtocolOptions = {},
): AliceState {
	validateParameters(count, b);
	const random = options.random ?? SECURE_RANDOM;
	const cipher = options.cipher ?? AES_BLOCK_CIPHER;
	const puzzles: Puzzle[] = [];
	const secrets: Uint8Array[] = [];
	let aliceOps = 0;

	for (let index = 0; index < count; index += 1) {
		const prefix = mode === 'textbook'
			? textbookPrefix()
			: clearSuffix(random.bytes(BLOCK_BYTES), b);
		const u = random.integer(2 ** b);
		const key = makeKey(prefix, u, b);
		const secret = random.bytes(BLOCK_BYTES);
		secrets.push(secret);

		aliceOps += 1;
		const cSecret = cipher.enc(key, secret);
		aliceOps += 1;
		const cIndex = cipher.enc(key, encodeIndex(index));
		aliceOps += 1;
		const cCheck = cipher.enc(key, ZERO_BLOCK);
		puzzles.push({ prefix, cSecret, cIndex, cCheck });
	}

	shuffle(puzzles, random);
	return { b, count, mode, puzzles, secrets, aliceOps };
}

export function bobSolve(
	puzzles: readonly Puzzle[],
	b: number,
	options: ProtocolOptions & { puzzlePosition?: number } = {},
): BobResult {
	if (puzzles.length === 0) throw new PuzzleIntegrityError('no-key', 'Alice supplied no puzzles');
	const random = options.random ?? SECURE_RANDOM;
	const cipher = options.cipher ?? AES_BLOCK_CIPHER;
	const puzzlePosition = options.puzzlePosition ?? random.integer(puzzles.length);
	if (!Number.isInteger(puzzlePosition) || puzzlePosition < 0 || puzzlePosition >= puzzles.length) {
		throw new RangeError('puzzlePosition is outside the transcript');
	}
	const puzzle = puzzles[puzzlePosition]!;
	const keySpace = 2 ** b;
	let firstKey: Uint8Array | undefined;
	let trials = 0;
	let auditOps = 0;
	let matchingKeys = 0;

	// The first-match count is Bob's protocol work. We finish the key space as
	// an integrity audit so the page can fail closed on the book's unlikely
	// multiple-match event; those extra AES calls are reported separately.
	for (let u = 0; u < keySpace; u += 1) {
		const key = makeKey(puzzle.prefix, u, b);
		if (firstKey === undefined) trials += 1;
		else auditOps += 1;
		const marker = cipher.dec(key, puzzle.cCheck);
		if (equalBytes(marker, ZERO_BLOCK)) {
			matchingKeys += 1;
			if (firstKey === undefined) firstKey = key;
		}
	}

	if (matchingKeys === 0 || firstKey === undefined) {
		throw new PuzzleIntegrityError('no-key', 'no weak key opens Bob’s selected puzzle');
	}
	if (matchingKeys > 1) {
		throw new PuzzleIntegrityError('ambiguous-key', `${matchingKeys} weak keys pass the check block; restart required`);
	}

	const index = decodeIndex(cipher.dec(firstKey, puzzle.cIndex), puzzles.length);
	const secret = cipher.dec(firstKey, puzzle.cSecret);
	return { index, secret, trials, auditOps, matchingKeys, puzzlePosition };
}

export function aliceLookup(state: AliceState, index: number): Uint8Array {
	const secret = state.secrets[index];
	if (!secret) throw new RangeError('published index is outside Alice’s puzzle list');
	return secret.slice();
}

// [extension] point: the random-oracle presentation, where both parties query
// H on independently sampled points from a domain of size n².
