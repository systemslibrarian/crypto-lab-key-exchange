import { AES_BLOCK_CIPHER, ZERO_BLOCK, makeKey, toHex, type BlockCipher } from './aes.ts';
import type { Puzzle } from './protocol.ts';

export interface TableAttackResult {
	tableOps: number;
	lookupOps: number;
	decryptOps: number;
	solved: number;
	secret?: Uint8Array;
}

/** Shared all-zero prefix from the deliberately broken printed form. */
export function textbookPrefix(): Uint8Array {
	return new Uint8Array(16);
}

function decodeIndex(block: Uint8Array, count: number): number | undefined {
	if (block.length !== 16) return undefined;
	for (let i = 0; i < 12; i += 1) if (block[i] !== 0) return undefined;
	const index = new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(12, false);
	return index >= 1 && index <= count ? index : undefined;
}

/**
 * The deliberately broken shared-zero-prefix form printed in Protocol 10.1.
 * One E(k, 0) table covers every puzzle because every weak key comes from the
 * same reduced key space. This module is never the default protocol path.
 */
export function tableAttack(
	puzzles: readonly Puzzle[],
	b: number,
	targetIndex: number,
	cipher: BlockCipher = AES_BLOCK_CIPHER,
): TableAttackResult {
	const zeroPrefix = textbookPrefix();
	const table = new Map<string, Uint8Array>();
	let tableOps = 0;
	for (let u = 0; u < 2 ** b; u += 1) {
		const key = makeKey(zeroPrefix, u, b);
		tableOps += 1;
		table.set(toHex(cipher.enc(key, ZERO_BLOCK)), key);
	}

	let lookupOps = 0;
	let decryptOps = 0;
	let solved = 0;
	let secret: Uint8Array | undefined;
	for (const puzzle of puzzles) {
		lookupOps += 1;
		const key = table.get(toHex(puzzle.cCheck));
		if (!key) continue;
		decryptOps += 1;
		const index = decodeIndex(cipher.dec(key, puzzle.cIndex), puzzles.length);
		if (index === undefined) continue;
		decryptOps += 1;
		const candidateSecret = cipher.dec(key, puzzle.cSecret);
		solved += 1;
		if (index === targetIndex) secret = candidateSecret;
	}
	return { tableOps, lookupOps, decryptOps, solved, secret };
}

/** Run the same shared-prefix table against independent-prefix puzzles. */
export function saltedTableAttempt(
	puzzles: readonly Puzzle[],
	b: number,
	cipher: BlockCipher = AES_BLOCK_CIPHER,
): { tableOps: number; lookupOps: number; matches: number } {
	const zeroPrefix = textbookPrefix();
	const markers = new Set<string>();
	let tableOps = 0;
	for (let u = 0; u < 2 ** b; u += 1) {
		tableOps += 1;
		markers.add(toHex(cipher.enc(makeKey(zeroPrefix, u, b), ZERO_BLOCK)));
	}
	let lookupOps = 0;
	let matches = 0;
	for (const puzzle of puzzles) {
		lookupOps += 1;
		if (markers.has(toHex(puzzle.cCheck))) matches += 1;
	}
	return { tableOps, lookupOps, matches };
}
