# crypto-lab-key-exchange

## What It Is

An interactive walk through five generations of key exchange: Diffie–Hellman (1976), ECDH (1985), X25519 (2006), ML-KEM (FIPS 203, 2024), and hybrid X25519+ML-KEM (2024). The point is that they're not five different problems — they're one problem ("agree on a shared secret over an open channel") solved in five different groups, with the last move stepping off the classical-group story entirely. The first three rely on the hardness of the discrete-log problem in Z_p* or on an elliptic curve, all of which Shor's algorithm breaks in polynomial time on a fault-tolerant quantum computer. ML-KEM rests on Module-LWE over polynomial rings — a lattice problem Shor doesn't touch — and hybrid is the bridge: derive a session key from both halves so neither failing alone breaks the channel. Every primitive in the demo is implemented from scratch in TypeScript with deliberately tiny parameters so the math is visible. The discrete-log attack on Z_p* is real and runs in milliseconds; the ML-KEM step is a *flow model* (not real Module-LWE) and is labelled as such throughout.

## When to Use It

- **Teaching the migration story** — show why "post-quantum" is not just a bigger key, it's a different mechanic.
- **Briefing engineers on hybrid** — make X25519MLKEM768 concrete by computing the combine yourself.
- **Demonstrating why discrete log fails on tiny primes** — the "Break it" button actually recovers Alice's secret exponent, and the same algorithm would take heat-death timescales on a real 2048-bit DH group.
- **Reference: in production, use these** — X25519 today for classical ECDH; ML-KEM (FIPS 203) for post-quantum; hybrid X25519+ML-KEM during migration. Use a vetted library (BoringSSL, OpenSSL, liboqs, libsodium, BouncyCastle) — never roll your own.
- Do NOT use this demo's tiny p, g, or curve for anything — they exist so the brute-force discrete log can run in your browser. That is the entire point of choosing them.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-key-exchange](https://systemslibrarian.github.io/crypto-lab-key-exchange/)**

The page is one long scrollable lesson with a sticky scroll-spy nav at the top. Inside: a production decision card, the five-generation tablist, live DH and MitM playgrounds, ECDH with a plot of every point on the demo curve, the KEM flow model, the hybrid combine, an all-five comparison table, sizes and history sections, a roster of real production deployments, interactive Shor classical order-finding, a Module-LWE visualization, a closing "remember three things" synthesis, and a references-and-glossary panel. Number keys `1`–`9` and `0` jump between sections; `?` opens the keyboard-shortcut help. Every interactive section carries an explicit threat-model chip strip (what it protects against, what it does not) and a visible "toy parameters" warning.

## What Can Go Wrong

- **Unauthenticated Diffie–Hellman** is wide open to a man-in-the-middle; key agreement must be authenticated by signatures, certificates, or a PAKE.
- **Weak or unvalidated group parameters** enable downgrade and precomputation attacks (e.g., Logjam against export-grade DH groups).
- **Reusing ephemeral keys** turns ephemeral DH into static DH and forfeits forward secrecy.
- **Skipping point/parameter validation** invites small-subgroup and invalid-curve attacks that can leak the private key.
- **Classical-only DH/ECDH** is vulnerable to harvest-now-decrypt-later once a large quantum computer exists — which is why hybrid X25519+ML-KEM exists.

## Real-World Usage

- **X25519** is the default key exchange in TLS 1.3 (RFC 8446) and in SSH.
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

## How to Teach From It

If you have **5 minutes** — the time it takes a manager to skim:
1. Production decision card (top of page) — "if I'm building today, use…"
2. The five-generation tablist — one screen, every mechanism named
3. The synthesis card near the bottom — "remember three things"

If you have **15 minutes** — a brown-bag walk-through:
1. Production decision card
2. Five-generation tablist (click each chip, read the mechanic and threat)
3. DH playground — change `a`, watch both ends agree
4. "Break it" — recover Alice's exponent and read the scaling table
5. MitM panel — see Alice and Bob end with mismatched secrets
6. KEM section — note the *shape* change vs DH
7. Hybrid combine — run it once, expand "Why is this secure if either half holds?"
8. Synthesis card

If you have **30 minutes** — a class or onboarding session:
1. Full top-to-bottom in nav order
2. Pause on ECDH for the point plot and the Curve25519 contrast table
3. Pause on Shor for the order-finding cycle and resource estimates
4. Pause on Module-LWE for the `b = A·s + e` matrix layout
5. End on References & glossary — every claim has a stable link

## Validation contract

What is tested, what is intentionally not tested, and how to run each:

| Test | Command | What it covers |
| --- | --- | --- |
| Engine unit tests | `npm test` | `modPow`, `modInverse`, `diffieHellman`, `discreteLogAttack`, `isOnCurve`, `ecAdd`, `ecMul` (incl. agreement with iterated addition and `n·G = ∞`), `ecdh` agreement for every scalar pair on the demo curve, `pointToString`, `mlkemEncapsulateDemo` shape, `hybridCombine` determinism and length. Deterministic. |
| Browser smoke | `npm run smoke` | Playwright/Chromium on three viewports (desktop 1280, iPhone 12, narrow 360×740). Exercises every interactive control end-to-end, the URL-hash deep-links, the keyboard shortcuts, the copy-to-clipboard chips, the EC curve plot, the MitM panel, the Shor cycle, and the Module-LWE matrices. Asserts no console errors and no horizontal overflow. |
| Accessibility audit | `npm run axe` | axe-core WCAG 2.1 A/AA against six configurations (3 viewport widths × 2 themes). Currently zero violations. |
| Full local CI pass | `npm run verify` | Runs `build` + `test` and then expects you to run `smoke` / `axe` against a `preview` server. (CI runs all of them automatically on every push and PR.) |

Additional scripts: `npm run build` (type-check + production build to `dist/`) and `npm run preview` (serve the built `dist/` locally). No environment variables, no API keys, no servers — everything runs client-side in the browser.

What is **not** tested, by design:
- The visual appearance of the EC curve plot (only the count of finite points and the highlight classification is asserted).
- The exact text of every long-form explanation — that would freeze the prose against intentional editing.
- Real-network behaviour. The page is fully static and client-side.
- Real post-quantum cryptography. ML-KEM in the engine is a flow model (random opaque bytes, labelled as such throughout); the real cryptography belongs in a vetted library.

CI runs `build + test + smoke + axe` on every push to `main` and on every PR (`.github/workflows/ci.yml`). The deploy workflow (`.github/workflows/deploy.yml`) only fires on push to `main`.

---

*One of 60+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
