# crypto-lab-key-exchange

## What It Is

An interactive walk through five generations of key exchange: Diffie–Hellman (1976), ECDH (1985), X25519 (2006), ML-KEM (FIPS 203, 2024), and hybrid X25519+ML-KEM (2024). The point is that they're not five different problems — they're one problem ("agree on a shared secret over an open channel") solved in five different groups, with the last move stepping off the classical-group story entirely. The first three rely on the hardness of the discrete-log problem in Z_p* or on an elliptic curve, all of which Shor's algorithm breaks in polynomial time on a fault-tolerant quantum computer. ML-KEM rests on Module-LWE over polynomial rings — a lattice problem Shor doesn't touch — and hybrid is the bridge: derive a session key from both halves so neither failing alone breaks the channel. Every primitive in the demo is implemented from scratch in TypeScript with deliberately tiny parameters so the math is visible. The discrete-log attack on Z_p* is real and runs in milliseconds; the ML-KEM step is a *flow model* (not real Module-LWE) and is labelled as such throughout.

## When to Use It

- **Teaching the migration story** — show why "post-quantum" is not just a bigger key, it's a different mechanic.
- **Briefing engineers on hybrid** — make X25519MLKEM768 concrete by computing the combine yourself.
- **Demonstrating why discrete log fails on tiny primes** — the "Break it" button actually recovers Alice's secret exponent, and the same algorithm would take heat-death timescales on a real 2048-bit DH group.
- **Reference: in production, use these** — X25519 today for classical ECDH; ML-KEM (FIPS 203) for post-quantum; hybrid X25519+ML-KEM during migration. Use a vetted library (BoringSSL, OpenSSL, liboqs, libsodium, BouncyCastle) — never roll your own.
- **Do NOT use this demo's tiny p, g, or curve for anything** — they exist so the brute-force discrete log can run in your browser. That is the entire point of choosing them.

## Live Demo

[**https://systemslibrarian.github.io/crypto-lab-key-exchange/**](https://systemslibrarian.github.io/crypto-lab-key-exchange/)

The page walks through five sections: a clickable timeline of the five generations with a PQ-safe / quantum-broken chip per row; a live Diffie–Hellman playground with inputs for the prime `p`, generator `g`, and Alice/Bob secret exponents `a` and `b`, showing the full arithmetic `A = g^a mod p`, `B = g^b mod p`, and both sides recomputing the shared value; a "Break it" button that runs `discreteLogAttack(g, A, p)` and recovers Alice's secret exponent in front of you; a live ECDH playground on `y² = x³ + 2x + 2 (mod 17)` with generator `G = (5, 1)` and order 19, showing the points `a·G`, `b·G`, and the agreement; an ML-KEM flow model (encapsulate-decapsulate with random opaque bytes — clearly labelled as a flow model, not real Module-LWE); and the hybrid combine that hashes the DH shared secret with the KEM secret into a 256-bit session key.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-key-exchange.git
cd crypto-lab-key-exchange
npm install
npm run dev      # local dev server with HMR
npm run build    # type-check + production build to dist/
npm run preview  # serve the built dist/ locally
```

No environment variables, no API keys, no servers. Everything runs client-side in the browser.

## Part of the Crypto-Lab Suite

This is one demo in a wider portfolio of interactive cryptography labs — see [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/) for the rest, including the five PQC families overview, hybrid TLS, harvest-now-decrypt-later timelines, and deep-dives on individual schemes.

---

"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31
