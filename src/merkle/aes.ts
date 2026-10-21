import { ecb } from '@noble/ciphers/aes.js';

export const BLOCK_BYTES = 16;
export const ZERO_BLOCK = new Uint8Array(BLOCK_BYTES);

export interface BlockCipher {
	enc(key16: Uint8Array, block16: Uint8Array): Uint8Array;
	dec(key16: Uint8Array, block16: Uint8Array): Uint8Array;
}

function requireBlock(value: Uint8Array, label: string): void {
	if (value.length !== BLOCK_BYTES) {
		throw new RangeError(`${label} must be exactly ${BLOCK_BYTES} bytes`);
	}
}

/** One raw AES block. ECB is used only as the book's block-cipher primitive. */
export function enc(key16: Uint8Array, block16: Uint8Array): Uint8Array {
	requireBlock(key16, 'AES-128 key');
	requireBlock(block16, 'AES block');
	return ecb(key16, { disablePadding: true }).encrypt(block16);
}

/** Inverse of {@link enc}; no padding layer is present. */
export function dec(key16: Uint8Array, block16: Uint8Array): Uint8Array {
	requireBlock(key16, 'AES-128 key');
	requireBlock(block16, 'AES block');
	return ecb(key16, { disablePadding: true }).decrypt(block16);
}

export const AES_BLOCK_CIPHER: BlockCipher = { enc, dec };

/**
 * Join the public 128-b-bit prefix to the b-bit weak suffix u.
 *
 * `prefix` is represented as a full block whose low b bits are already zero.
 * Clearing them again makes this boundary fail closed when a caller supplies a
 * malformed prefix, and makes the key-space split explicit at the call site.
 */
export function makeKey(prefix: Uint8Array, u: number, b: number): Uint8Array {
	requireBlock(prefix, 'key prefix');
	if (!Number.isInteger(b) || b < 1 || b > 30) throw new RangeError('b must be an integer from 1 to 30');
	const keySpace = 2 ** b;
	if (!Number.isInteger(u) || u < 0 || u >= keySpace) {
		throw new RangeError(`u must be an integer from 0 to ${keySpace - 1}`);
	}

	const key = prefix.slice();
	for (let bit = 0; bit < b; bit += 1) {
		const byteIndex = BLOCK_BYTES - 1 - Math.floor(bit / 8);
		const mask = 1 << (bit % 8);
		key[byteIndex] = (key[byteIndex]! & ~mask) | (((u >>> bit) & 1) ? mask : 0);
	}
	return key;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i += 1) difference |= a[i]! ^ b[i]!;
	return difference === 0;
}

export function toHex(value: Uint8Array): string {
	return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string): Uint8Array {
	if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('hex must contain complete bytes');
	return Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}
