// data.ts — narrative corpus for the key-exchange evolution demo.
//
// Five generations connect by a single thread: "agree on a shared secret
// over an open channel." Each row records what mechanic the generation
// introduced, what hard problem its security depended on, what key size
// was typical, what drove the move to the next generation, and how the
// arrival of a large quantum computer changes the picture.

export interface Generation {
	id: string;
	year: number;
	name: string;
	mechanic: string;
	hardProblem: string;
	keySize: string;
	drove: string;
	threat: string;
	pqSafe: boolean;
}

export const GENERATIONS: Generation[] = [
	{
		id: 'dh',
		year: 1976,
		name: 'Diffie–Hellman',
		mechanic:
			'Both sides raise a public generator g to a private exponent in a finite field Z_p*; they swap the public values and re-exponentiate. Same secret on both ends.',
		hardProblem:
			'Discrete logarithm in Z_p*: given p, g, and g^a mod p, recovering a is conjectured hard for large prime p.',
		keySize: '2048–4096-bit primes today; this demo uses tiny p to make the math visible.',
		drove:
			'Beautiful but heavy: arithmetic on multi-thousand-bit numbers is expensive, and index-calculus attacks chip away at the security margin every few years.',
		threat:
			'Broken by Shor’s algorithm on a large fault-tolerant quantum computer — the discrete-log problem in Z_p* falls in polynomial time.',
		pqSafe: false,
	},
	{
		id: 'ecdh',
		year: 1985,
		name: 'ECDH (Elliptic-curve Diffie–Hellman)',
		mechanic:
			'Replace Z_p* with the additive group of points on an elliptic curve. Scalar multiplication k·G is the new exponentiation; the symmetric-key derivation is otherwise identical to DH.',
		hardProblem:
			'Elliptic-curve discrete logarithm (ECDLP): given P and k·P on a curve, find k. No sub-exponential algorithm is known classically.',
		keySize:
			'~256-bit curves match ~3072-bit classical DH security — a roughly 12× key-size reduction.',
		drove:
			'Mobile and embedded devices needed shorter keys and faster handshakes. ECC made TLS with forward secrecy practical on phones.',
		threat:
			'Also broken by Shor — the elliptic-curve discrete-log problem falls in the same polynomial-time framework.',
		pqSafe: false,
	},
	{
		id: 'x25519',
		year: 2006,
		name: 'X25519',
		mechanic:
			'A specific Montgomery curve (Curve25519) with a constant-time scalar-multiplication ladder. Same group-theoretic story as ECDH; the engineering is what changed.',
		hardProblem:
			'ECDLP on Curve25519 — chosen with rigid, verifiable parameters to rule out the suspicion of back-door curves.',
		keySize: '32-byte public keys, 32-byte shared secrets. Hard-coded; no agility, no parameter negotiation.',
		drove:
			'NIST P-curves’ history (and Dual_EC_DRBG fallout) created demand for transparently-chosen curves with side-channel-resistant implementations. TLS 1.3 picked X25519 as the default.',
		threat:
			'Still ECDLP under the hood; still broken by Shor on a large quantum computer.',
		pqSafe: false,
	},
	{
		id: 'mlkem',
		year: 2024,
		name: 'ML-KEM (FIPS 203, derived from Kyber)',
		mechanic:
			'Not Diffie–Hellman at all. A Key Encapsulation Mechanism: Bob generates a fresh secret and encrypts it TO Alice’s public key; Alice decapsulates with her secret key. Different shape, same end state — both parties hold the same key.',
		hardProblem:
			'Module Learning-With-Errors (Module-LWE) over polynomial rings. Conjectured hard for both classical and quantum adversaries.',
		keySize: '~800–1568-byte public keys and ciphertexts depending on parameter set (ML-KEM-512/768/1024).',
		drove:
			'Harvest-now-decrypt-later. Traffic recorded today against X25519 becomes plaintext the moment a useful quantum computer exists. NIST PQC standardisation chose ML-KEM as the primary KEM in 2024.',
		threat:
			'No known quantum algorithm breaks Module-LWE in polynomial time. Confidence comes from sustained cryptanalysis rather than a reduction to a single proven-hard problem.',
		pqSafe: true,
	},
	{
		id: 'hybrid',
		year: 2024,
		name: 'Hybrid X25519+ML-KEM',
		mechanic:
			'Run both X25519 and ML-KEM in parallel, then derive the session key from H(x25519Secret || mlkemSecret). Both halves must break to break the channel.',
		hardProblem:
			'Either ECDLP on Curve25519 *or* Module-LWE must hold. The combined session key is at least as strong as the stronger of the two.',
		keySize: 'Sum of both: ~32 + ~1100 bytes for X25519MLKEM768, depending on the parameter set.',
		drove:
			'Belt-and-braces migration. ML-KEM is young; X25519 has decades of cryptanalysis. Hybrid hedges against an unknown weakness in either while you transition.',
		threat:
			'A quantum computer breaks the X25519 half, but not the ML-KEM half — so the combined key still resists. A future weakness in ML-KEM still leaves X25519 protecting classical adversaries.',
		pqSafe: true,
	},
];

export interface KeyMoment {
	title: string;
	body: string;
	year?: number;
}

export const WHY_IT_MATTERS: KeyMoment[] = [
	{
		title: 'The math kept moving, the *idea* did not',
		body: 'DH, ECDH, and X25519 are the same protocol in three different groups. Each move bought shorter keys, faster handshakes, or cleaner engineering — never a different security story. ML-KEM is the first step that changed the mechanic itself.',
	},
	{
		title: 'Shor invalidates three generations in one move',
		year: 1994,
		body: 'Peter Shor’s algorithm doesn’t care whether the group is Z_p*, an NIST curve, or Curve25519 — discrete logarithms in any abelian group fall in polynomial time on a fault-tolerant quantum computer.',
	},
	{
		title: 'Harvest now, decrypt later',
		body: 'A nation-state can record TLS handshakes today and decrypt them once it has the quantum hardware. That timeline is the entire reason ML-KEM is being deployed before the threat fully materialises.',
	},
	{
		title: 'Hybrid is the bridge, not the destination',
		year: 2024,
		body: 'Production deployments — Cloudflare, Apple iMessage PQ3, Signal, AWS KMS — use X25519MLKEM768 today: belt-and-braces during the transition. If ML-KEM is later weakened, X25519 still protects classical adversaries; if a quantum computer arrives, ML-KEM still protects.',
	},
];
