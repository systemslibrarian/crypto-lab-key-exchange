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

export interface SizeEntry {
	id: string;
	label: string;
	bytes: number;
	note: string;
}

// Public-key byte sizes per generation, at the parameter sets each is
// actually deployed at. DH is at 2048-bit (~256 bytes). ECDH/X25519 is
// 32 bytes (Curve25519). ML-KEM-768 is 1184 bytes (FIPS 203). Hybrid
// X25519MLKEM768 sums the two halves.
export const SIZES: SizeEntry[] = [
	{ id: 'dh', label: 'DH (2048-bit)', bytes: 256, note: 'p ≈ 2^2048; one big number per side.' },
	{ id: 'ecdh', label: 'ECDH (P-256)', bytes: 32, note: 'Compressed point on a 256-bit curve.' },
	{ id: 'x25519', label: 'X25519', bytes: 32, note: 'Hard-coded Curve25519, 32-byte u-coordinate.' },
	{ id: 'mlkem', label: 'ML-KEM-768', bytes: 1184, note: 'FIPS 203 default; ciphertext is 1088 bytes.' },
	{ id: 'hybrid', label: 'X25519MLKEM768', bytes: 1216, note: '32 + 1184. Production hybrid in TLS 1.3 today.' },
];

export interface HistoryEvent {
	year: number;
	title: string;
	body: string;
	kind: 'invention' | 'attack' | 'standard' | 'deployment';
}

// The dated spine of the migration story. Every entry is something a
// reader can look up and verify; no folk history.
export const HISTORY: HistoryEvent[] = [
	{
		year: 1976,
		kind: 'invention',
		title: 'Diffie–Hellman key exchange',
		body: 'Whitfield Diffie and Martin Hellman publish "New Directions in Cryptography" — the first public-key protocol for agreeing a shared secret over an open channel.',
	},
	{
		year: 1985,
		kind: 'invention',
		title: 'Elliptic-curve cryptography proposed',
		body: 'Independently, Neal Koblitz and Victor Miller propose using the group of points on an elliptic curve over a finite field as the setting for discrete-log cryptography.',
	},
	{
		year: 1994,
		kind: 'attack',
		title: 'Shor’s algorithm',
		body: 'Peter Shor publishes a polynomial-time quantum algorithm for integer factorisation and discrete logarithms — invalidating DH, ECDH, RSA, and DSA on a sufficiently large quantum computer.',
	},
	{
		year: 2006,
		kind: 'invention',
		title: 'Curve25519',
		body: 'Daniel J. Bernstein publishes Curve25519: rigid parameters, constant-time scalar multiplication, designed for high-speed and side-channel-resistant ECDH.',
	},
	{
		year: 2013,
		kind: 'attack',
		title: 'Dual_EC_DRBG backdoor revealed',
		body: 'Snowden disclosures confirm long-suspected back-door in NIST’s Dual_EC random number generator, accelerating adoption of transparently-chosen curves like Curve25519 and Ed25519.',
	},
	{
		year: 2016,
		kind: 'standard',
		title: 'NIST PQC standardisation begins',
		body: 'NIST opens a multi-year competition to standardise post-quantum public-key cryptography. Kyber (later ML-KEM) is a lattice-based KEM submission.',
	},
	{
		year: 2018,
		kind: 'standard',
		title: 'TLS 1.3 (RFC 8446)',
		body: 'TLS 1.3 ships with X25519 as the recommended classical key exchange and an ephemeral-only handshake — the baseline that hybrid PQ is added on top of.',
	},
	{
		year: 2022,
		kind: 'attack',
		title: 'SIKE broken',
		body: 'Castryck and Decru break SIKE — a NIST-finalist isogeny-based KEM — on a laptop in hours. A reminder that "post-quantum candidate" is not "post-quantum proven."',
	},
	{
		year: 2024,
		kind: 'standard',
		title: 'FIPS 203 (ML-KEM)',
		body: 'NIST publishes FIPS 203 standardising ML-KEM (Kyber). Production deployments — X25519MLKEM768 in TLS 1.3, Apple iMessage PQ3, AWS KMS, Signal — start the same year.',
	},
];

export interface Deployment {
	name: string;
	year: number;
	what: string;
	url: string;
}

export const DEPLOYMENTS: Deployment[] = [
	{
		name: 'Cloudflare',
		year: 2023,
		what: 'X25519Kyber768 (and later X25519MLKEM768) on all TLS connections by default; client and server.',
		url: 'https://blog.cloudflare.com/post-quantum-for-all/',
	},
	{
		name: 'Google Chrome',
		year: 2024,
		what: 'X25519MLKEM768 enabled by default in Chrome 131 for TLS handshakes to compatible servers.',
		url: 'https://blog.chromium.org/2024/05/advancing-our-amazing-bet-on-asymmetric.html',
	},
	{
		name: 'Apple iMessage',
		year: 2024,
		what: 'PQ3 protocol — hybrid ECDH + ML-KEM key establishment, plus post-compromise security via continuous rekeying.',
		url: 'https://security.apple.com/blog/imessage-pq3/',
	},
	{
		name: 'Signal',
		year: 2023,
		what: 'PQXDH: extends the X3DH key-agreement protocol with an ML-KEM (Kyber) round for post-quantum forward secrecy.',
		url: 'https://signal.org/docs/specifications/pqxdh/',
	},
	{
		name: 'AWS KMS',
		year: 2024,
		what: 'TLS endpoints for KMS, ACM, and Secrets Manager accept hybrid X25519MLKEM768 for post-quantum key establishment.',
		url: 'https://aws.amazon.com/blogs/security/aws-pqc-tls/',
	},
];

export interface Reference {
	authors: string;
	year: number;
	title: string;
	venue: string;
	url: string;
}

export const REFERENCES: Reference[] = [
	{
		authors: 'W. Diffie, M. Hellman',
		year: 1976,
		title: 'New Directions in Cryptography',
		venue: 'IEEE Trans. Inf. Theory 22(6)',
		url: 'https://ee.stanford.edu/~hellman/publications/24.pdf',
	},
	{
		authors: 'N. Koblitz',
		year: 1987,
		title: 'Elliptic curve cryptosystems',
		venue: 'Mathematics of Computation 48',
		url: 'https://www.ams.org/journals/mcom/1987-48-177/S0025-5718-1987-0866109-5/',
	},
	{
		authors: 'V. S. Miller',
		year: 1985,
		title: 'Use of Elliptic Curves in Cryptography',
		venue: 'CRYPTO ’85',
		url: 'https://link.springer.com/chapter/10.1007/3-540-39799-X_31',
	},
	{
		authors: 'P. Shor',
		year: 1994,
		title: 'Algorithms for quantum computation: discrete logarithms and factoring',
		venue: 'FOCS 1994',
		url: 'https://ieeexplore.ieee.org/document/365700',
	},
	{
		authors: 'D. J. Bernstein',
		year: 2006,
		title: 'Curve25519: New Diffie-Hellman Speed Records',
		venue: 'PKC 2006',
		url: 'https://cr.yp.to/ecdh/curve25519-20060209.pdf',
	},
	{
		authors: 'NIST',
		year: 2024,
		title: 'FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism Standard',
		venue: 'NIST',
		url: 'https://csrc.nist.gov/pubs/fips/203/final',
	},
	{
		authors: 'D. Stebila, S. Fluhrer, S. Gueron',
		year: 2024,
		title: 'Hybrid key exchange in TLS 1.3',
		venue: 'IETF draft-ietf-tls-hybrid-design',
		url: 'https://datatracker.ietf.org/doc/draft-ietf-tls-hybrid-design/',
	},
	{
		authors: 'W. Castryck, T. Decru',
		year: 2022,
		title: 'An efficient key recovery attack on SIDH',
		venue: 'EUROCRYPT 2023',
		url: 'https://eprint.iacr.org/2022/975',
	},
];

export interface GlossaryEntry {
	term: string;
	def: string;
}

export const GLOSSARY: GlossaryEntry[] = [
	{
		term: 'KEM',
		def: 'Key Encapsulation Mechanism. Bob generates a fresh secret and encrypts it to Alice’s public key; Alice decapsulates. The asymmetric-encryption shape of "agree on a shared key."',
	},
	{
		term: 'DH / ECDH',
		def: 'Diffie–Hellman. Both sides exponentiate a public generator to a private exponent in a group; they swap public values and re-exponentiate to a shared secret. ECDH is the same protocol in the elliptic-curve point group.',
	},
	{
		term: 'ECDLP',
		def: 'Elliptic-Curve Discrete Logarithm Problem. Given points P and k·P on a curve, recover k. The hardness assumption underlying every elliptic-curve cryptosystem.',
	},
	{
		term: 'Module-LWE',
		def: 'Module Learning-With-Errors. ML-KEM’s underlying hard problem: distinguish (A, A·s + e) from uniformly random, where s and e are short vectors over a polynomial ring. No known polynomial-time quantum attack.',
	},
	{
		term: 'Hybrid',
		def: 'Run a classical key exchange (X25519) and a post-quantum KEM (ML-KEM) in parallel, then derive the session key from both halves. Secure if either holds.',
	},
	{
		term: 'Harvest-now-decrypt-later',
		def: 'An attacker records encrypted traffic today and decrypts it when a sufficiently large quantum computer becomes available. The driver behind PQ migration of long-lived secrets.',
	},
	{
		term: 'IND-CCA2',
		def: 'Indistinguishability under adaptive chosen-ciphertext attack — the strongest standard KEM security notion. Required by TLS-style protocols where the same key may decrypt many adversarially-chosen ciphertexts.',
	},
	{
		term: 'FIPS 203',
		def: 'NIST’s Federal Information Processing Standard for ML-KEM, published August 2024. The first standardised post-quantum KEM.',
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
