# crypto-lab-key-exchange

## What It Is

An interactive walk through five generations of key exchange: Diffie–Hellman (1976), ECDH (1985), X25519 (2006), ML-KEM (FIPS 203, 2024), and hybrid X25519+ML-KEM (2024). A prequel section runs Merkle puzzles (1978): key agreement from AES alone, with real work counters, and shows the protocol's quadratic limit. The prequel is not a sixth generation and the five-generation timeline remains unchanged. The point is that the generations are not five different problems — they are one problem ("agree on a shared secret over an open channel") solved in five different groups, with the last move stepping off the classical-group story entirely.

The Merkle section uses real single-block AES-128 from [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers). Its safe default is a clearly labelled lab modification: each puzzle has an independent public key prefix. The shared-zero-prefix form printed in Boneh–Shoup v0.6 §10.8 remains available only behind a **BROKEN** switch because one reusable `E(k, 0)` table solves every puzzle. Neither form is production cryptography.

The first three public-key generations rely on the hardness of the discrete-log problem in Z_p* or on an elliptic curve, all of which Shor's algorithm breaks in polynomial time on a fault-tolerant quantum computer. ML-KEM rests on Module-LWE over polynomial rings — a lattice problem Shor doesn't touch — and hybrid is the bridge: derive a session key from both halves so neither failing alone breaks the channel. The DH and ECDH primitives are implemented from scratch in TypeScript with deliberately tiny parameters so the math is visible; the discrete-log attack on Z_p* is real and runs in milliseconds. The ML-KEM step is **real ML-KEM-768 (FIPS 203)** from [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum) — production-grade parameters, full Module-LWE, NTT, and compression — and the hybrid combine mixes an actual X25519 secret with the ML-KEM secret through HKDF, matching the shape of the production X25519MLKEM768 combiner.

## Exhibits

1. **Merkle-puzzle prequel.** Build and shuffle independent AES puzzles, let Bob brute-force one, compare Alice's and Bob's 128-bit secrets byte for byte, then run Eve over the transcript alone. The three-row work meter places measured AES calls beside the derived `3L`, `(|K|+1)/2`, and `((L+1)/2)·((|K|+1)/2)` predictions.
2. **The one-table break.** The non-default textbook-form switch uses one shared reduced key space. A real `E(k, 0)` table solves every puzzle; switching back to independent prefixes makes the same table match zero puzzles in the evidence fixture.
3. **Five generations.** The existing tablist keeps DH, ECDH, X25519, ML-KEM, and hybrid as five generations with their mechanics, assumptions, sizes, migration pressure, and quantum status.
4. **DH and active interception.** Run toy Diffie–Hellman, see why both exponent towers meet at `g^(ab)`, recover a toy exponent, then watch a real AES-GCM relay succeed until Ed25519 authentication stops it.
5. **ECDH.** Plot the full toy curve and step through scalar multiplication one point at a time before contrasting the toy curve with Curve25519.
6. **ML-KEM and hybrid.** Run real ML-KEM-768, mutate its ciphertext, and combine its secret with a real X25519 secret through HKDF.
7. **Compare, sizes, and dated history.** Put all five deployed generations on one screen, compare byte sizes, and follow the evidence-backed history now including Merkle's 1978 paper.
8. **Shor and Module-LWE.** Inspect classical order finding and its spectrum, then toggle Module-LWE noise and run the actual modular solver to see why the error term matters.
9. **Production and synthesis.** Connect the mechanisms to current deployments, then close with the three distinctions the lesson is designed to preserve.

## When to Use It

- **Teaching the migration story** — show why "post-quantum" is not just a bigger key, it's a different mechanic.
- **Briefing engineers on hybrid** — make X25519MLKEM768 concrete by computing the combine yourself.
- **Demonstrating why discrete log fails on tiny primes** — the "Break it" button actually recovers Alice's secret exponent, and the same algorithm would take heat-death timescales on a real 2048-bit DH group.
- **Reference: in production, use these** — X25519 today for classical ECDH; ML-KEM (FIPS 203) for post-quantum; hybrid X25519+ML-KEM during migration. Use a vetted library (BoringSSL, OpenSSL, liboqs, libsodium, BouncyCastle) — never roll your own.
- Do NOT use this demo's tiny p, g, or curve for anything — they exist so the brute-force discrete log can run in your browser. That is the entire point of choosing them.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-key-exchange](https://systemslibrarian.github.io/crypto-lab-key-exchange/)**

The page is one long scrollable lesson with a sticky scroll-spy nav at the top. A **"New here?" banner** points a first-timer straight at the DH playground, and the engineer-facing production decision card is tucked behind a "for engineers" disclosure so a newcomer meets arithmetic before jargon. Inside: the Merkle-puzzle prequel and its live Alice/Bob/Eve work meter; the five-generation tablist; a live DH playground whose **"why do they match?" panel** renders the two exponent towers `(g^a)^b` and `(g^b)^a` collapsing to the same `g^(ab)` so the commutativity is *shown*, not asserted; a MitM playground that goes past the mismatched numbers — a **relay exhibit** where Eve's HKDF-derived AES-256-GCM key really decrypts Alice's ciphertext, optionally rewrites it, and re-encrypts it to Bob (whose decryption then succeeds with every tag verifying), plus a signed-key-share variant where a real Ed25519 verification fails and Alice aborts before sending, with a control verification over Bob's genuine share returning valid in the same run; ECDH with a plot of every point on the demo curve plus a **step-by-step scalar-multiplication walk** (`G → 2G → 3G → … → a·G`) that lights up the numbered hops so the random-looking walk behind ECDLP is visible; a live real ML-KEM-768 encapsulation (including a forge check that flips a ciphertext bit); the hybrid combine with **live provenance chips** showing which half came from which section; an all-five comparison table; sizes and history sections; a roster of real production deployments; interactive Shor classical order-finding backed by a **"Shor in three registers" visualization** (the real periodic `a^x mod N` and the real |DFT| of that window peaking at multiples of `1/r`, labelled as the classical stand-in for the quantum step); a Module-LWE panel where you can **flip the noise `e` on and off and run real Gaussian elimination** — it recovers the secret exactly with noise off and lands on a wrong, non-short vector with noise on; a closing "remember three things" synthesis; and a references-and-glossary panel. Number keys `1`–`9` and `0` jump to the first ten nav entries; adding Puzzles after Generations shifts each later shortcut by one, and `?` opens the regenerated keyboard-shortcut help. Every interactive section carries an explicit threat-model chip strip (what it protects against, what it does not) and a visible "toy parameters" warning.

## What Can Go Wrong

- **Unauthenticated Diffie–Hellman** is wide open to a man-in-the-middle; key agreement must be authenticated by signatures, certificates, or a PAKE. The MitM section lets you mount the relay for real and then watch signed key shares defeat it.
- **Weak or unvalidated group parameters** enable downgrade and precomputation attacks (e.g., Logjam against export-grade DH groups).
- **Reusing ephemeral keys** turns ephemeral DH into static DH and forfeits forward secrecy.
- **Skipping point/parameter validation** invites small-subgroup and invalid-curve attacks that can leak the private key.
- **Classical-only DH/ECDH** is vulnerable to harvest-now-decrypt-later once a large quantum computer exists — which is why hybrid X25519+ML-KEM exists.

## Real-World Usage

- **X25519** is a widely used TLS 1.3 key-share group (RFC 9846 recommends supporting it) and is used in SSH.
- **The Signal Protocol** builds X3DH and the Double Ratchet on X25519.
- **WireGuard** uses X25519 in its Noise-based handshake.
- **ML-KEM** (FIPS 203) is NIST's standardized post-quantum KEM.
- **Hybrid X25519MLKEM768** is deployed in TLS 1.3 by Chrome and Cloudflare for the migration period.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-key-exchange
cd crypto-lab-key-exchange
npm install
npm run dev
```

## Related Demos

- [crypto-lab-curve-lens](https://systemslibrarian.github.io/crypto-lab-curve-lens/) — ECC and ECDH on Curve25519 and P-256 up close.
- [crypto-lab-hybrid-wire](https://systemslibrarian.github.io/crypto-lab-hybrid-wire/) — the X25519 + ML-KEM-768 hybrid wire protocol end to end.
- [crypto-lab-pq-tls-handshake](https://systemslibrarian.github.io/crypto-lab-pq-tls-handshake/) — X25519MLKEM768 inside the TLS 1.3 key schedule.
- [crypto-lab-x3dh-wire](https://systemslibrarian.github.io/crypto-lab-x3dh-wire/) — Signal's X3DH key agreement.
- [crypto-lab-noise-pipe](https://systemslibrarian.github.io/crypto-lab-noise-pipe/) — Noise handshake patterns over X25519.
- [crypto-lab-agreeing-in-public](https://systemslibrarian.github.io/crypto-lab-agreeing-in-public/) — the beginner version of agreeing on a secret while a watcher sees every message.
- [crypto-lab-grover](https://systemslibrarian.github.io/crypto-lab-grover/) — why generic quantum search erases the classical Merkle-puzzle gap.

## How to Teach From It

If you have **5 minutes** — the time it takes a manager to skim:
1. Production decision card (top of page) — "if I'm building today, use…"
2. The five-generation tablist — one screen, every mechanism named
3. The synthesis card near the bottom — "remember three things"

If you have **15 minutes** — a brown-bag walk-through:
1. Production decision card
2. Five-generation tablist (click each chip, read the mechanic and threat)
3. Merkle-puzzle prequel — build the independent form, run Bob and Eve, then flip on the visibly broken textbook form to see one table solve every puzzle
4. DH playground — change `a`, watch both ends agree, then read the "why do they match?" panel to see the exponents commute to `g^(ab)`
5. "Break it" — recover Alice's exponent and read the scaling table
6. MitM panel — see Alice and Bob end with mismatched secrets, then hit **Relay it** and watch Eve decrypt the actual message and re-encrypt it to Bob; hit **Same attack — signed key shares** to watch an Ed25519 check stop the identical attack
7. KEM section — note the *shape* change vs DH
8. Hybrid combine — run it once, expand "Why is this secure if either half holds?"
9. Synthesis card

If you have **30 minutes** — a class or onboarding session:
1. Full top-to-bottom in nav order
2. Pause on ECDH for the point plot, the "walk a·G one hop at a time" animation, and the Curve25519 contrast table
3. Pause on Shor for the order-finding cycle, the "Shor in three registers" periodicity/spectrum visualization, and the resource estimates
4. Pause on Module-LWE for the `b = A·s + e` matrix layout, then flip the noise off/on and run the solver to feel why the noise is the whole game
5. End on References & glossary — every claim has a stable link

## Validation contract

What is tested, what is intentionally not tested, and how to run each:

| Test | Command | What it covers |
| --- | --- | --- |
| Engine unit tests | `npm test` | `modPow`, `modInverse`, `diffieHellman`, `discreteLogAttack`, `isOnCurve`, `ecAdd`, `ecMul` (incl. agreement with iterated addition and `n·G = ∞`), `ecdh` agreement for every scalar pair on the demo curve, `pointToString`; **real ML-KEM-768** FIPS 203 sizes (1184/1088/32), encapsulate↔decapsulate round-trip, implicit rejection of a flipped-bit ciphertext and of the wrong decapsulation key; `hybridCombine` determinism, fixed-width DH encoding, and the full `hybridHandshake` (real X25519 + real ML-KEM-768) both-ends-agree check; and the `mitmRelay` exhibit — Eve's real AES-GCM decrypt of Alice's ciphertext, her relay landing in Bob's plaintext, Bob's real tag failure on Alice's own ciphertext, and the signed-key-share variant aborting before anything is sent (with the honest no-attacker control still going through). Deterministic except for fresh keygen/encapsulation randomness (asserted on properties, not fixed bytes). |
| Merkle puzzle + AES unit tests | `npm test` | The FIPS 197-upd1 Appendix B AES-128 block, all four blocks from NIST SP 800-38A F.1.1, 100 Alice/Bob agreements, transcript-only Eve input, the 1,024/1,024 textbook table break, the salted-table negative control, ambiguity restart, cap/cancel paths, exact counters, and a repeated Eve mean checked against variance-derived tolerance. |
| Browser smoke | `npm run smoke` | Playwright/Chromium on three viewports (desktop 1280, iPhone 12, narrow 360×740). Exercises every interactive control end-to-end, the URL-hash deep-links, the keyboard shortcuts, the copy-to-clipboard chips, the EC curve plot, the MitM panel, the Shor cycle, and the Module-LWE matrices. Asserts no console errors and no horizontal overflow. |
| Browser exhibit + WCAG suite | `npm run test:a11y` | The Playwright suite in `e2e/`: the WCAG A/AA gate at desktop, 380px, and 320px with Merkle and MitM results rendered; computed MitM outcomes; and `claims.spec.ts`, created for this extension, which independently recomputes every displayed Merkle work claim, reads both secrets, inspects the real worker payload, checks retirement/no-op behaviour, and reaches the §4.1d recovery fixture. It also cross-checks eight random noble AES blocks against WebCrypto AES-CBC's zero-IV first block. |
| Merkle verdict mutations | `npm run test:mutations` | Six concrete patches in `mutations/ledger.json`. The runner requires a green named control, a non-empty source diff, a successful build, a moved production-bundle hash, that named test red with `--retries=0`, and a restored matching bundle plus green control. |
| Accessibility audit | `npm run axe` | axe-core WCAG 2.1 A/AA against six configurations (3 viewport widths × 2 themes). Currently zero violations. |
| Full local CI pass | `npm run verify` | Runs `build` + `test` and then expects you to run `smoke` / `axe` against a `preview` server. (CI runs all of them automatically on every push and PR.) |

Additional scripts: `npm run build` (type-check + production build to `dist/`) and `npm run preview` (serve the built `dist/` locally). No environment variables, no API keys, no servers — everything runs client-side in the browser.

What is **not** tested, by design:
- The visual appearance of the EC curve plot (only the count of finite points and the highlight classification is asserted).
- The exact text of every long-form explanation — that would freeze the prose against intentional editing.
- Real-network behaviour. The page is fully static and client-side.

The ML-KEM step is **not** simulated: it is real ML-KEM-768 (FIPS 203) from the vetted `@noble/post-quantum` library, and the hybrid combine mixes a real X25519 secret with the real ML-KEM secret via HKDF. The DH and ECDH panels remain deliberately toy-sized (so the discrete-log break can run in your browser) and are labelled as such; those toy parameters are the only "not for production" primitives in the demo.

CI runs `build + test + smoke + axe` on every push to `main` and on every PR (`.github/workflows/ci.yml`). The deploy workflow (`.github/workflows/deploy.yml`) only fires on push to `main`.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
