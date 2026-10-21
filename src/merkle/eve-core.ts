import { AES_BLOCK_CIPHER, ZERO_BLOCK, equalBytes, makeKey, type BlockCipher } from './aes.ts';
import { SECURE_RANDOM, type Puzzle, type RandomSource } from './protocol.ts';

export interface EvePuzzle {
	prefix: Uint8Array;
	c1: Uint8Array;
	c2: Uint8Array;
	c3: Uint8Array;
}

export interface EveTranscript {
	puzzles: EvePuzzle[];
	targetIndex: number;
}

export interface EvePayload {
	transcript: EveTranscript;
	b: number;
	cap: number;
}

export interface EveProgress {
	operations: number;
	puzzlesTried: number;
}

export type EveResult =
	| { status: 'recovered'; secret: Uint8Array; operations: number; auxiliaryOps: number; puzzlesTried: number }
	| { status: 'incomplete'; operations: number; auxiliaryOps: number; puzzlesTried: number }
	| { status: 'integrity-error'; operations: number; auxiliaryOps: number; puzzlesTried: number };

export interface EveOptions {
	cipher?: BlockCipher;
	random?: RandomSource;
	onProgress?: (progress: EveProgress) => void;
	isCancelled?: () => boolean;
	yieldEvery?: number;
}

export function makeEvePayload(
	puzzles: readonly Puzzle[],
	targetIndex: number,
	b: number,
	cap: number,
): EvePayload {
	return {
		transcript: {
			puzzles: puzzles.map((puzzle) => ({
				prefix: puzzle.prefix.slice(),
				c1: puzzle.cSecret.slice(),
				c2: puzzle.cIndex.slice(),
				c3: puzzle.cCheck.slice(),
			})),
			targetIndex,
		},
		b,
		cap,
	};
}

function decodeIndex(block: Uint8Array, count: number): number | undefined {
	if (block.length !== 16) return undefined;
	for (let i = 0; i < 12; i += 1) if (block[i] !== 0) return undefined;
	const index = new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(12, false);
	return index < count ? index : undefined;
}

function shuffledIndices(length: number, random: RandomSource): number[] {
	const out = Array.from({ length }, (_, index) => index);
	for (let i = out.length - 1; i > 0; i -= 1) {
		const j = random.integer(i + 1);
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

/**
 * Exhaust the public transcript until Eve reaches the puzzle whose encrypted
 * index equals Bob's announcement. `operations` counts marker-decryption AES
 * calls only, which is the trial work in the displayed derivation; the two
 * decryptions after a match are reported separately as `auxiliaryOps`.
 */
export async function eveBruteForce(
	payload: EvePayload,
	options: EveOptions = {},
): Promise<EveResult> {
	const { transcript, b, cap } = payload;
	if (!Number.isInteger(b) || b < 8 || b > 14) throw new RangeError('b must be from 8 through 14');
	if (!Number.isInteger(cap) || cap < 1) throw new RangeError('cap must be a positive integer');
	if (!Number.isInteger(transcript.targetIndex) || transcript.targetIndex < 0 || transcript.targetIndex >= transcript.puzzles.length) {
		throw new RangeError('target index is outside the transcript');
	}
	const cipher = options.cipher ?? AES_BLOCK_CIPHER;
	const random = options.random ?? SECURE_RANDOM;
	const order = shuffledIndices(transcript.puzzles.length, random);
	const yieldEvery = Math.max(1, options.yieldEvery ?? 4096);
	let operations = 0;
	let auxiliaryOps = 0;
	let puzzlesTried = 0;
	let sinceYield = 0;

	for (const position of order) {
		const puzzle = transcript.puzzles[position]!;
		puzzlesTried += 1;
		for (let u = 0; u < 2 ** b; u += 1) {
			if (options.isCancelled?.()) return { status: 'incomplete', operations, auxiliaryOps, puzzlesTried };
			if (operations >= cap) return { status: 'incomplete', operations, auxiliaryOps, puzzlesTried };
			const key = makeKey(puzzle.prefix, u, b);
			operations += 1;
			sinceYield += 1;
			const marker = cipher.dec(key, puzzle.c3);
			if (equalBytes(marker, ZERO_BLOCK)) {
				auxiliaryOps += 1;
				const index = decodeIndex(cipher.dec(key, puzzle.c2), transcript.puzzles.length);
				if (index === undefined) continue;
				if (index === transcript.targetIndex) {
					auxiliaryOps += 1;
					const secret = cipher.dec(key, puzzle.c1);
					options.onProgress?.({ operations, puzzlesTried });
					return { status: 'recovered', secret, operations, auxiliaryOps, puzzlesTried };
				}
				break;
			}
			if (sinceYield >= yieldEvery) {
				sinceYield = 0;
				options.onProgress?.({ operations, puzzlesTried });
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
		}
	}
	return { status: 'integrity-error', operations, auxiliaryOps, puzzlesTried };
}
