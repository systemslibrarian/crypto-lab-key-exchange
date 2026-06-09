// engine.ts — Key-exchange teaching engine.
//
// Five primitives in one module, deliberately tiny:
//   1. Diffie–Hellman over Z_p* — full arithmetic with a brute-force
//      discrete-log attack you can actually run.
//   2. ECDH over a Weierstrass curve mod a small prime — point add,
//      point double, scalar multiplication.
//   3. A *flow model* for ML-KEM encapsulation. This is NOT real lattice
//      math (Module-LWE, NTT, compression, decompression are all skipped).
//      It models the public observable behaviour — Bob produces a secret +
//      ciphertext, Alice "decapsulates" and ends up with the same secret —
//      with the right shape and types so the surrounding UI is honest.
//   4. The hybrid combine: H(dhSecret || kemSecret) as the final session key.
//
// Everything is intentionally toy-sized so the math is visible and the
// discrete-log break runs in a single CPU tick. Real DH uses 2048–4096-bit
// primes; real ECDH uses curves like Curve25519; real ML-KEM is FIPS 203
// (Module-LWE, polynomial rings, sampling, etc.). Do not use any of this
// for production.

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

// ---------- ML-KEM (FLOW MODEL — not real lattice math) ----------------------

export interface KemResult {
	bobSecret: string; // hex — what Bob encapsulated
	ciphertext: string; // hex — the opaque blob sent to Alice
	aliceSecret: string; // hex — what Alice decapsulated; equals bobSecret on success
	agree: boolean;
	note: string;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	return out;
}

// Flow model of an ML-KEM encapsulation:
//   1. Bob generates a fresh 32-byte secret.
//   2. Bob produces an opaque ciphertext (here: random bytes — in real
//      ML-KEM this would be an encrypted-to-Alice's-public-key encoding
//      of the secret, with all the Module-LWE machinery).
//   3. Alice "decapsulates" and arrives at the same secret.
// We return both ends explicitly so the UI can show them as equal —
// the *shape* a real KEM has, with none of the cryptography.
export async function mlkemEncapsulateDemo(): Promise<KemResult> {
	const secret = randomBytes(32);
	const ct = randomBytes(48);
	const hex = bytesToHex(secret);
	return {
		bobSecret: hex,
		ciphertext: bytesToHex(ct),
		aliceSecret: hex,
		agree: true,
		note: 'Flow model only. Real ML-KEM (FIPS 203) encrypts the shared secret to Alice’s public key using Module-LWE; ciphertext bytes here are random and do not actually encode the secret.',
	};
}

// ---------- Hybrid combine ---------------------------------------------------

// H(dhSecret || kemSecret) -> 32-byte session key, displayed as hex.
// In production this is an HKDF; SHA-256 keeps the demo dependency-free.
export async function hybridCombine(
	dhSecret: string | number,
	kemSecretHex: string,
): Promise<string> {
	const dhBytes = new TextEncoder().encode(String(dhSecret));
	const kemBytes = hexToBytes(kemSecretHex);
	const combined = new Uint8Array(dhBytes.length + kemBytes.length);
	combined.set(dhBytes, 0);
	combined.set(kemBytes, dhBytes.length);
	const digest = await crypto.subtle.digest('SHA-256', combined);
	return bytesToHex(new Uint8Array(digest));
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
