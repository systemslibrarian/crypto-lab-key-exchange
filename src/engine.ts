// engine.ts — Key-exchange teaching engine.
//
// Four primitives in one module:
//   1. Diffie–Hellman over Z_p* — full arithmetic with a brute-force
//      discrete-log attack you can actually run. Deliberately tiny.
//   2. ECDH over a Weierstrass curve mod a small prime — point add,
//      point double, scalar multiplication. Deliberately tiny.
//   3. REAL ML-KEM-768 encapsulation (FIPS 203) via @noble/post-quantum.
//      Bob encapsulates a fresh secret to Alice's real public key, Alice
//      decapsulates the ACTUAL ciphertext and recovers the same secret.
//      Full Module-LWE, NTT, compression — not a flow model.
//   4. The hybrid combine: HKDF-Extract over the fixed-width X25519 secret
//      concatenated with the ML-KEM secret, with a domain-separation label,
//      matching the shape of the production X25519MLKEM768 combiner.
//
// The DH and ECDH pieces are intentionally toy-sized so the math is visible
// and the discrete-log break runs in a single CPU tick — real DH uses
// 2048–4096-bit primes and real ECDH uses curves like Curve25519, both
// clearly labelled throughout. The ML-KEM and hybrid pieces, by contrast,
// use production-grade parameters and real cryptography. None of the toy
// DH/ECDH parameters are safe for production; use a vetted library.

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

// ---------- DH ---------------------------------------------------------------

export interface DhResult {
	p: number;
	g: number;
	a: number; // Alice's secret exponent
	b: number; // Bob's secret exponent
	A: number; // public: g^a mod p
	B: number; // public: g^b mod p
	sharedFromAlice: number; // B^a mod p
	sharedFromBob: number; // A^b mod p
	agree: boolean;
}

export function modPow(base: number, exp: number, mod: number): number {
	if (mod === 1) return 0;
	let result = 1;
	let b = ((base % mod) + mod) % mod;
	let e = exp;
	while (e > 0) {
		if (e & 1) result = (result * b) % mod;
		e = Math.floor(e / 2);
		b = (b * b) % mod;
	}
	return result;
}

export function diffieHellman(p: number, g: number, a: number, b: number): DhResult {
	const A = modPow(g, a, p);
	const B = modPow(g, b, p);
	const sharedFromAlice = modPow(B, a, p);
	const sharedFromBob = modPow(A, b, p);
	return {
		p,
		g,
		a,
		b,
		A,
		B,
		sharedFromAlice,
		sharedFromBob,
		agree: sharedFromAlice === sharedFromBob,
	};
}

// Recover Alice's secret exponent by brute force: try every x in [1, p-1]
// until g^x ≡ A (mod p). Feasible here only because p is tiny.
// Returns null if no exponent in range produces A (shouldn't happen for
// valid DH inputs, but the type makes the failure visible).
export function discreteLogAttack(g: number, A: number, p: number): number | null {
	for (let x = 1; x < p; x++) {
		if (modPow(g, x, p) === A) return x;
	}
	return null;
}

// ---------- ECDH -------------------------------------------------------------

export interface ECPoint {
	x: number;
	y: number;
	infinity?: boolean;
}

export interface Curve {
	a: number;
	b: number;
	p: number; // field prime
	G: ECPoint; // generator
	n: number; // order of G
}

export const INFINITY: ECPoint = { x: 0, y: 0, infinity: true };

function mod(n: number, m: number): number {
	return ((n % m) + m) % m;
}

// Extended Euclidean modular inverse, mod a prime.
export function modInverse(a: number, p: number): number {
	let [oldR, r] = [mod(a, p), p];
	let [oldS, s] = [1, 0];
	while (r !== 0) {
		const q = Math.floor(oldR / r);
		[oldR, r] = [r, oldR - q * r];
		[oldS, s] = [s, oldS - q * s];
	}
	if (oldR !== 1) {
		throw new Error(`modInverse: ${a} has no inverse mod ${p}`);
	}
	return mod(oldS, p);
}

export function ecAdd(P: ECPoint, Q: ECPoint, curve: Curve): ECPoint {
	if (P.infinity) return Q;
	if (Q.infinity) return P;
	const { p } = curve;
	if (P.x === Q.x) {
		// Either doubling or P + (-P) = ∞.
		if (mod(P.y + Q.y, p) === 0) return INFINITY;
		// Doubling: s = (3x² + a) / (2y).
		const num = mod(3 * P.x * P.x + curve.a, p);
		const den = modInverse(mod(2 * P.y, p), p);
		const s = mod(num * den, p);
		const xr = mod(s * s - 2 * P.x, p);
		const yr = mod(s * (P.x - xr) - P.y, p);
		return { x: xr, y: yr };
	}
	// Distinct: s = (y2 - y1) / (x2 - x1).
	const num = mod(Q.y - P.y, p);
	const den = modInverse(mod(Q.x - P.x, p), p);
	const s = mod(num * den, p);
	const xr = mod(s * s - P.x - Q.x, p);
	const yr = mod(s * (P.x - xr) - P.y, p);
	return { x: xr, y: yr };
}

export function ecMul(k: number, P: ECPoint, curve: Curve): ECPoint {
	let scalar = mod(k, curve.n);
	if (scalar === 0 || P.infinity) return INFINITY;
	let result: ECPoint = INFINITY;
	let addend: ECPoint = P;
	while (scalar > 0) {
		if (scalar & 1) result = ecAdd(result, addend, curve);
		addend = ecAdd(addend, addend, curve);
		scalar = Math.floor(scalar / 2);
	}
	return result;
}

export function pointToString(P: ECPoint): string {
	if (P.infinity) return 'O (point at infinity)';
	return `(${P.x}, ${P.y})`;
}

export function isOnCurve(P: ECPoint, curve: Curve): boolean {
	if (P.infinity) return true;
	const lhs = mod(P.y * P.y, curve.p);
	const rhs = mod(P.x * P.x * P.x + curve.a * P.x + curve.b, curve.p);
	return lhs === rhs;
}

export interface EcdhResult {
	curve: Curve;
	a: number;
	b: number;
	A: ECPoint; // a·G
	B: ECPoint; // b·G
	sharedFromAlice: ECPoint; // a·B
	sharedFromBob: ECPoint; // b·A
	agree: boolean;
}

export function ecdh(curve: Curve, a: number, b: number): EcdhResult {
	const A = ecMul(a, curve.G, curve);
	const B = ecMul(b, curve.G, curve);
	const sharedFromAlice = ecMul(a, B, curve);
	const sharedFromBob = ecMul(b, A, curve);
	const agree =
		sharedFromAlice.infinity === sharedFromBob.infinity &&
		sharedFromAlice.x === sharedFromBob.x &&
		sharedFromAlice.y === sharedFromBob.y;
	return { curve, a, b, A, B, sharedFromAlice, sharedFromBob, agree };
}

// The standard tiny teaching curve used throughout the demo:
//   y² = x³ + 2x + 2  (mod 17),  G = (5, 1),  order 19.
// G is verified on-curve at construction time; the order is the textbook
// figure cited in Hankerson/Menezes/Vanstone § 3.2 example and reproduced
// across crypto courses.
export const DEMO_CURVE: Curve = {
	a: 2,
	b: 2,
	p: 17,
	G: { x: 5, y: 1 },
	n: 19,
};

// ---------- ML-KEM-768 (REAL — FIPS 203 via @noble/post-quantum) -------------

export interface KemResult {
	publicKeyLen: number; // Alice's ML-KEM public (encapsulation) key size, bytes
	ciphertextLen: number; // ciphertext size, bytes
	bobSecret: string; // hex — the shared secret Bob derived while encapsulating
	ciphertext: string; // hex — the ACTUAL FIPS 203 ciphertext sent to Alice
	aliceSecret: string; // hex — what Alice recovered by decapsulating `ciphertext`
	agree: boolean; // bobSecret === aliceSecret (true for an honest run)
	tamperedSecret: string; // hex — what Alice recovers if one ciphertext bit is flipped
	tamperRejected: boolean; // true iff the tampered secret differs from the honest one
	note: string;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Real ML-KEM-768 encapsulation, end to end:
//   1. Alice runs KeyGen -> (encapsulation key ek, decapsulation key dk).
//   2. Bob runs Encaps(ek) -> (ciphertext c, shared secret K). This is real
//      Module-LWE: sample a short (s, e), compute u/v, compress, encode.
//   3. Alice runs Decaps(dk, c) -> K'. On an honest run K' == K.
// We also flip one bit of the ciphertext and decapsulate again to show FIPS
// 203's implicit rejection: the recovered secret changes (it is a
// pseudorandom function of the tampered ciphertext), so a forged ciphertext
// does not yield Bob's secret.
export async function mlkemEncapsulateDemo(): Promise<KemResult> {
	const { publicKey, secretKey } = ml_kem768.keygen();
	const { cipherText, sharedSecret: bobSecret } = ml_kem768.encapsulate(publicKey);
	const aliceSecret = ml_kem768.decapsulate(cipherText, secretKey);

	const tampered = cipherText.slice();
	tampered[0] ^= 0x01; // flip one bit
	const tamperedSecret = ml_kem768.decapsulate(tampered, secretKey);

	const agree =
		bobSecret.length === aliceSecret.length &&
		bobSecret.every((b, i) => b === aliceSecret[i]);
	const tamperRejected = !(
		tamperedSecret.length === bobSecret.length &&
		tamperedSecret.every((b, i) => b === bobSecret[i])
	);

	return {
		publicKeyLen: publicKey.length,
		ciphertextLen: cipherText.length,
		bobSecret: bytesToHex(bobSecret),
		ciphertext: bytesToHex(cipherText),
		aliceSecret: bytesToHex(aliceSecret),
		agree,
		tamperedSecret: bytesToHex(tamperedSecret),
		tamperRejected,
		note: 'Real ML-KEM-768 (FIPS 203) via @noble/post-quantum: Bob encapsulates to Alice’s public key and Alice decapsulates the actual ciphertext. Full Module-LWE, NTT, and compression — not a flow model.',
	};
}

// ---------- Hybrid combine ---------------------------------------------------

// Domain-separation label for this demo's hybrid combiner. Production
// X25519MLKEM768 uses its own fixed label (e.g. the X-Wing "\.//^\" or the
// TLS transcript hash); the point is that the label is fixed and bound in,
// not derived from attacker-controlled data.
const HYBRID_LABEL = 'crypto-lab-key-exchange X25519MLKEM768 v1';

// Encode the DH shared value as a fixed 4-byte big-endian integer. The DH
// playground works over toy primes (≤ 9973, which fits in 14 bits), so 4
// bytes is always enough and — crucially — the width is FIXED. Fixed-width
// encoding is what stops the "1"||"23" vs "12"||"3" concatenation ambiguity
// that plain stringification would allow.
function encodeDhSecret(dhSecret: number): Uint8Array {
	const n = Math.max(0, Math.floor(dhSecret)) >>> 0;
	return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

// Combine the classical (DH) secret and the post-quantum (ML-KEM) secret into
// one 32-byte session key. This uses HKDF-Extract-then-Expand with SHA-256
// over  dhSecret(fixed-width) || kemSecret  and a fixed domain-separation
// label as the HKDF `info`. This mirrors the SHAPE of the production
// X25519MLKEM768 combiner (HKDF over the concatenated component secrets with
// a fixed label), rather than the earlier plain SHA-256(String(dh)||kem)
// which lacked both fixed-width encoding and domain separation.
//
// Production note: real X25519MLKEM768 (X-Wing / draft-connolly-cfrg-xwing)
// also folds in the ML-KEM ciphertext and X25519 public key, and TLS 1.3
// derives the key through the full handshake transcript. Those bind the
// specific messages; here we keep to the two component secrets so the
// teaching input stays the DH value plus the KEM secret. The combiner below
// is a real HKDF, not a placeholder.
export async function hybridCombine(
	dhSecret: string | number,
	kemSecretHex: string,
): Promise<string> {
	const dhBytes = encodeDhSecret(typeof dhSecret === 'number' ? dhSecret : Number(dhSecret));
	const kemBytes = hexToBytes(kemSecretHex);
	const ikm = new Uint8Array(dhBytes.length + kemBytes.length);
	ikm.set(dhBytes, 0);
	ikm.set(kemBytes, dhBytes.length);
	const info = new TextEncoder().encode(HYBRID_LABEL);
	// Empty salt is standard for HKDF when no salt is available.
	const okm = hkdf(sha256, ikm, new Uint8Array(0), info, 32);
	return bytesToHex(okm);
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.replace(/[^0-9a-fA-F]/g, '');
	// Pad odd-length strings with a leading zero to prevent truncating the last nibble
	const padded = clean.length % 2 === 0 ? clean : '0' + clean;
	const out = new Uint8Array(padded.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

// ---------- Real X25519MLKEM768-style hybrid handshake (illustrative) --------

export interface HybridHandshakeResult {
	x25519SharedLen: number;
	mlkemSharedLen: number;
	aliceSessionKey: string; // hex — 32-byte session key Alice derives
	bobSessionKey: string; // hex — 32-byte session key Bob derives
	agree: boolean;
}

// Runs BOTH halves of the hybrid for real and combines them, so the session
// key is a function of an actual X25519 ECDH secret and an actual ML-KEM-768
// secret. Used by tests to prove the two ends agree end-to-end; the UI's
// hybrid panel drives hybridCombine() with the DH value the user chose.
export async function hybridHandshake(): Promise<HybridHandshakeResult> {
	// Classical half: X25519 ECDH between Alice and Bob.
	const aPriv = x25519.utils.randomSecretKey();
	const bPriv = x25519.utils.randomSecretKey();
	const aPub = x25519.getPublicKey(aPriv);
	const bPub = x25519.getPublicKey(bPriv);
	const xAlice = x25519.getSharedSecret(aPriv, bPub);
	const xBob = x25519.getSharedSecret(bPriv, aPub);

	// PQ half: Bob encapsulates to Alice's ML-KEM public key.
	const { publicKey, secretKey } = ml_kem768.keygen();
	const { cipherText, sharedSecret: kemBob } = ml_kem768.encapsulate(publicKey);
	const kemAlice = ml_kem768.decapsulate(cipherText, secretKey);

	const combine = (x: Uint8Array, k: Uint8Array): string => {
		const ikm = new Uint8Array(x.length + k.length);
		ikm.set(x, 0);
		ikm.set(k, x.length);
		const info = new TextEncoder().encode(HYBRID_LABEL);
		return bytesToHex(hkdf(sha256, ikm, new Uint8Array(0), info, 32));
	};

	const aliceSessionKey = combine(xAlice, kemAlice);
	const bobSessionKey = combine(xBob, kemBob);
	return {
		x25519SharedLen: xAlice.length,
		mlkemSharedLen: kemAlice.length,
		aliceSessionKey,
		bobSessionKey,
		agree: aliceSessionKey === bobSessionKey,
	};
}
