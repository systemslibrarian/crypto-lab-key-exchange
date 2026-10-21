# Extension brief — `crypto-lab-key-exchange`

**2026-10-20. Extension to a live lab; no new repository.** Written against
`crypto-lab-key-exchange` at `88e5a0a1a268` and `audits/_MASTER-TEMPLATE.md` (catalog
`20cb434d89e4`). Template §5: "Extend, never restructure." Source of the gap: Boneh–Shoup v0.6
§10.8, "Merkle puzzles: a partial solution to key exchange using block ciphers" (Protocol 10.1).

**Verdict: extension — a prequel section, "Before public keys: Merkle puzzles", inside the
existing lab.**

## Which lab hosts it, and why

I opened both candidates.

- **Agreeing in Public** (`crypto-lab-agreeing-in-public` at `e5cbf32207eb`). This is a
  Beginner lab. Its own `brief.md` lists "the discrete logarithm, modular exponentiation,
  curve arithmetic…" as non-goals and states its thesis as "watching the conversation is not
  enough to join it." Merkle puzzles teach the opposite nuance: watching *is* enough, if you
  pay L² work. Adding the puzzles would blur that lab's one message.
- **Key Exchange** (`88e5a0a1a268`). This lab is a historical walk. `README.md:5` describes it
  as "five generations of key exchange: Diffie–Hellman (1976) … hybrid", and
  `src/data.ts:128` holds a dated `HISTORY` spine "with no folk history". Merkle puzzles,
  published in 1978, are the honest **prequel**: key agreement with only a symmetric cipher,
  and the reason public-key cryptography was needed.

**Pick: Key Exchange.** The section is a prequel, never a sixth generation, and the page says
so: it was never deployed. Agreeing in Public is cross-linked from the new section and not
edited.

## What the lab has now (at 88e5a0a1a268)

- **Section order** is set in `src/ui.ts:2317` `mountApp`: hero → section nav → beginner
  banner → decision card → `renderTimeline()` (`#generations`, `:145`) → `renderDhPlayground()`
  (`#dh`, `:245`) → MitM → ECDH → KEM → hybrid → compare → sizes → `renderHistory()`
  (`#history`) → production → Shor → M-LWE → synthesis.
- **Navigation.**
  - `NAV_LINKS` (`src/ui.ts:2136`) has 15 entries.
  - `wireKeyboardShortcuts` (`:2182`) maps digits to `NAV_LINKS[0..9]`, and its help list is
    generated from the array.
  - `scripts/smoke.mjs:125–130` **asserts exactly 15 nav links and 9 history items.** Both
    must be updated.
- **Engine.**
  - `src/engine.ts` uses JS-number DH/ECDH at toy sizes, real ML-KEM-768 via
    `@noble/post-quantum`, and real X25519 and HKDF via `@noble/curves` / `@noble/hashes`.
    `mitmRelay` (`:204`) uses WebCrypto AES-GCM.
  - There is no symmetric brute force anywhere. `grep -i merkle|puzzle` over `src/`,
    `index.html` and `README.md` finds nothing.
- **Tests.**
  - `npm test` = `node --test scripts/engine.test.mjs`, using Node's strip-types.
  - `scripts/smoke.mjs` and `scripts/axe.mjs` run in CI.
  - `e2e/` has `a11y.spec.ts`, `mitm-relay.spec.ts` (computed-outcome assertions) and
    `brand-name.spec.ts`. There is **no `e2e/claims.spec.ts`**: create it per §4.1b, and say
    so in the handoff.
  - There is **no mutation runner**. `crypto-lab-rsa-small-roots/scripts/mutations.mjs` is a
    working concrete-patch runner you may model one on. Otherwise record each mutation as a
    concrete patch and run §4.1c's five steps by hand.
- **README.** Sections run What It Is … Related Demos · How to Teach From It · Validation
  contract (a test table). There is no numbered Exhibits list.

**Fleet check.** I grepped my clones of the labs listed in `CATALOG.md` at `20cb434d89e4` (pulled 2026-10-20; excluding node_modules, .git and dist) for
`merkle.?puzzle|merkle.s puzzle`. I found zero hits. ("Merkle" alone hits Merkle *trees* in
many labs, a different construction.) Agent: re-run at HEAD.

## Self-correction: the book's Protocol 10.1, as printed, falls to one table

The gap analysis promised "honest parties ~L, eavesdropper ~L²". That holds only if the puzzles
are **independent**. Protocol 10.1 makes them dependent in two ways:

1. Every puzzle key comes from the *same* reduced key space. "Fixing the 98 most significant
   bits of the key to zero" gives |K| = 2³⁰.
2. Every puzzle carries the check block **E(kᵢ, 0)**, which depends on kᵢ alone.

So an eavesdropper computes E(k, 0) once for every k ∈ K, which is |K| encryptions. She then
looks up each puzzle's third block in that table and recovers **every** puzzle key, followed by
the index and secret. Total work is about |K| + L, the same order as the honest parties.

Evidence. My Node prototype used `@noble/ciphers` AES with |K| = L = 2¹⁰. One table of 1,024
encryptions solved 1,024 of 1,024 puzzles in about 12 ms. This contradicts the section's
ideal-cipher claim (success ≈ Q/(L·|K|)) for the protocol as printed. Within that model the
table is just |K| queries.

What the lab does about it:

- **Default protocol (the lab's modification, labelled in-page as such).** Each puzzle gets its
  own public random 128−b-bit key prefix rᵢ, in place of the shared zeros. Puzzle i =
  (rᵢ, E(kᵢ, sᵢ), E(kᵢ, i), E(kᵢ, 0)) with kᵢ = rᵢ ‖ uᵢ and secret uᵢ ∈ {0,1}^b. A table now
  serves one puzzle only, so the eavesdropper is back to about L·|K|. This is the independence
  Barak–Mahmoody's random-oracle form gets from drawing fresh points from a domain of size n².
- **"Textbook form" toggle.** Shared zero prefix, exactly as in §10.8. It is isolated, never
  the default, and visibly marked broken. The one-table attack runs against it.

Agent: before building the UI, reproduce the table attack in a unit test. If it does *not*
solve the textbook-form puzzles, stop and report. That would mean this analysis is wrong.

## What to add — the section `#puzzles`

**Plain-language lead-in.** Alice locks a thousand small boxes with weak locks. Each box
holds a random number and a secret. Bob picks one box at random and spends a minute
picking its lock, then tells everyone the number he found. Alice knows which secret goes
with that number. An eavesdropper doesn't know which box Bob opened, so she has to pick
locks until she finds the box with that number. With a thousand boxes, that takes her about
a thousand times longer than Bob. That gap is the whole protocol, and it is not enough.

**Headline mechanism: the work meter.** Three live counters, Alice, Bob and Eve, each
measured in real AES operations, sit beside their predicted values:

- Alice: about 3L encryptions.
- Bob: expected (|K|+1)/2 trial decryptions.
- Eve, salted form: expected about ((L+1)/2)·((|K|+1)/2). She solves puzzles in random order
  and stops at the one whose index is ℓ.
- Eve, textbook form with the table: about |K| + L.

The page must label these formulas as derived here, from the protocol and uniform choices. They
are not quoted from the book, which states O(L) / O(|K|) / O(L·|K|).

1. **Alice builds the puzzles.** Controls: key bits b (8–14, default 10) and puzzle count L
   (2⁸–2¹², default 2¹⁰). She shuffles them (Fisher–Yates with `crypto.getRandomValues`) and
   the first few puzzles are shown in hex.
2. **Bob solves one.**
   - He picks a puzzle uniformly at random and brute-forces uᵢ until D(k, c₃) = 0, with a live
     trial count.
   - He decrypts the index ℓ and the secret s, and publishes ℓ.
   - Alice looks up s for that ℓ, and the page asserts **byte-for-byte equality** of Alice's
     and Bob's s.
3. **Eve, salted.**
   - She runs a worker over the transcript only (all puzzles plus ℓ), with progress, cancel
     and the counter.
   - Live runs are capped at 2²⁴ trials. Above the cap, the page extrapolates from the formula
     and labels it "extrapolated".
4. **Eve, textbook form (toggle).** She builds one E(k, 0) table, solves every puzzle and
   recovers s. Verdict: **BROKEN — one table of |K| encryptions solved all L puzzles**.
   Switching back to salted reruns the same table and shows it matching only by chance
   (expected zero hits).
5. **At real scale (computed, not run).** Use the book's example, L ≈ |K| ≈ 2³⁰. Honest parties
   do about 2³⁰ operations each and Eve about 2⁵⁸ (salted, from the formula above). Then the
   punchline: a quadratic gap is the best block ciphers or random oracles can do. Impagliazzo–
   Rudich (which the book cites) and Barak–Mahmoody (a matching O(n²)-query attack on any
   random-oracle key exchange) back this up. Diffie–Hellman's larger gap rests on an
   *assumption*. The next section is that move.

Optional one-liner, linking the Grover lab: Brassard et al. (CRYPTO 2011) show Merkle's classical
scheme is "completely insecure against a quantum adversary".

## SECURITY / CORRECTNESS INVARIANTS

1. **Real AES only.**
   - Use `@noble/ciphers` single-block AES-ECB, padding disabled.
   - This is a **new dependency**. Justification: WebCrypto needs an async `importKey` per
     trial key, which makes the brute-force counters infeasible at teaching speed. Synchronous
     AES from the same audited `@noble` family already in `package.json` fixes that.
   - I verified the API at `@noble/ciphers` 2.4.0. Measured: about 2.8 µs per fresh-key
     single-block operation in Node in my sandbox. Browser numbers must be measured, not
     assumed.
2. **Eve sees only the transcript.** The worker message type contains the puzzles, the
   prefixes and ℓ, and no uᵢ, sᵢ or Bob's choice. Assert this in a test.
3. **Counters count real operations.** Every counter increment sits beside an AES call, and is
   tested by a mutation.
4. **The textbook form is isolated.**
   - It lives in `src/merkle/textbook-form.ts`.
   - It is never the default.
   - It is marked "BROKEN: shared key space, fixed check block" everywhere it surfaces.
5. **Ambiguity is handled.** If Bob finds two keys passing the check (Protocol 10.1 step 2's
   "unlikely event"), the run restarts and says so. Test this with an injected toy cipher in a
   unit test.
6. **No persistence.** Everything is per-session and in memory.

## ARCHITECTURE

- **`src/merkle/aes.ts`** — a thin wrapper `enc(key16, block16)` / `dec(key16, block16)` over
  `@noble/ciphers` (the only import site), plus `makeKey(prefix, u, b)`.
- **`src/merkle/protocol.ts`** — `buildPuzzles(L, b, mode)`, `bobSolve(puzzles, b)` (returns
  `{ index, s, trials }`) and `aliceLookup(state, ℓ)`.
- **`src/merkle/textbook-form.ts`** — the zero-prefix form and `tableAttack(puzzles, b, ℓ)`
  (returns `{ tableOps, solved, s }`).
- **`src/merkle/eve.worker.ts`** — `eveBruteForce(transcript, b, cap)`. Load it with Vite's
  `new Worker(new URL(...), { type: 'module' })`.
- **`src/ui.ts`**
  - `renderPuzzles()`, mounted in `mountApp` right after `renderTimeline()`.
  - A `NAV_LINKS` entry `{ hash: 'puzzles', label: 'Puzzles' }` after `generations`. This shifts
    later digit shortcuts by one. The help dialog regenerates; say so in the README.
- **`src/data.ts`** — add a `HISTORY` entry `{ year: 1978, kind: 'invention', title: 'Merkle
  puzzles', body: 'Ralph Merkle, "Secure Communications over Insecure Channels", Communications
  of the ACM 21(4), April 1978 — key agreement from a symmetric cipher alone, with only a
  quadratic work gap.' }`, between the 1976 and 1985 entries.

## UI

- **A `section.id = 'puzzles'`**, using the lab's existing panel-card, tab-button and toy-banner
  classes.
- **A toy banner:** "b-bit keys are toy-scale; the book's example is |K| = 2³⁰."
- **Controls.** Two sliders, each with a number input as a keyboard fallback. Buttons: "Build
  puzzles", "Bob solves one", "Run Eve", and the "Textbook form" switch.
- **The work meter** is a three-row bar chart on a log scale, with the numbers printed and text
  labels. Bars grow only when real operations complete (no decorative motion).
- **aria-live** for the agreement and Eve verdicts. Stacks under 640px.

## VISUAL SEMANTICS

- **Agreement:** neutral success, "Alice and Bob hold the same 128-bit secret", shown with both
  hex strings.
- **Eve recovers s (salted):** ALARM with icon: "RECOVERED BY THE EAVESDROPPER — after N
  operations (≈ L× Bob's)". Never green.
- **Textbook-form table attack:** ALARM, "BROKEN".
- **Salted table attempt:** SAFE, "table matches 0 puzzles — puzzles are independent".
- Never colour alone; check grayscale and deuteranopia.

## EDGE CASES

| Input | Fail-closed behaviour |
|---|---|
| b < 8 or b > 14, L outside 2⁸–2¹² | Refused, with the range named |
| Eve's run above the cap | Stops at the cap, reports "incomplete", and shows the extrapolation (labelled) |
| Bob finds no key (impossible unless a bug) | Integrity error, verdict withdrawn |
| Two keys pass Bob's check | Restart, announced |
| Changing b, L or the mode mid-run | Retire all verdicts, cancel the worker, say why. Re-selecting the same mode is a no-op |
| Worker unavailable | Run on the main thread with a lower cap, labelled |

## EXTENSION SEAMS

- `// [extension] point` in `eve.worker.ts`: a quantum-eavesdropper cost line (Grover per
  puzzle). This would link `crypto-lab-grover`. Prose only.
- `// [extension] point` in `protocol.ts`: the random-oracle form (Barak–Mahmoody's
  presentation), where both parties query H on random points from [n²].

## Tests

- **AES KATs** (in the `node --test` suite, alongside `scripts/engine.test.mjs`, with `npm test`
  updated to run both files):
  - FIPS 197-upd1 Appendix B: key `2b7e1516…09cf4f3c`, input `3243f6a8…e0370734`, output
    `3925841d02dc09fbdc118597196a0b32`. *Self-correction:* in FIPS 197-upd1 the worked
    example is in Appendix B; Appendix C now points to NIST's online vectors.
  - NIST SP 800-38A §F.1.1 ECB-AES128, **all four blocks**. This exceeds one block, as the
    batch rules require; the first block is `3ad77bb40d7a3660a89ecaf32466ef97`.
  - Cross-check random keys against WebCrypto AES-CBC with a zero IV (first block) in Playwright.
- **Protocol unit tests.**
  - Agreement over 100 runs.
  - The textbook-form table attack solves every puzzle (the prototype result above).
  - In salted form, the same table matches none.
  - Eve's measured mean over repeated toy runs (b = 8, L = 2⁸) falls within a stated tolerance
    of ((L+1)/2)·((|K|+1)/2). Compute the tolerance from the variance; do not hand-pick it.
- **New `e2e/claims.spec.ts`.**
  - Read both s values off the page and assert they are equal.
  - Recompute the predicted counters from the displayed L and b, and assert they match.
  - Assert the measured counters are within tolerance.
  - Assert the textbook-form verdict appears only with the toggle on.
  - Assert the worker payload has no `u`, `s` or Bob-choice fields.
  - Retirement on change, plus a no-op guard.
- **Update `scripts/smoke.mjs:126`** (nav links 15 → 16) and **`:130`** (history items 9 → 10),
  and extend `e2e/a11y.spec.ts` to scan the section with results rendered, at 320px too.
- **§4.1c mutations** (concrete patches, five steps each):
  1. Use the zero prefix in salted mode. The "salted table matches none" test goes red.
  2. Bob checks `c2` instead of `c3`. The agreement test goes red.
  3. Drop Eve's counter increment. The counter-vs-prediction test goes red.
  4. Compute the agreement verdict from Alice's s twice. The byte-equality claim goes red.
  5. Alter the displayed formula. The recompute test goes red.
  6. Delete the negative-claim text. §4.1d goes red.
- **§4.1d negative claim.** "Merkle puzzles give only a quadratic work gap: an eavesdropper who
  spends about L·|K| block-cipher operations recovers the secret. The protocol is not secure
  in the cryptographic sense."
  - **Fixture:** salted mode, defaults. Every check is green: agreement equal, Bob's key
    unique, the salted table attack matching nothing. Eve then recovers s live. The page shows
    **AGREED — AND RECOVERED BY THE EAVESDROPPER**, with the claim visible in that state.

## README and card follow-up

- **What It Is.** Add one sentence: "a prequel section runs Merkle puzzles (1978): key
  agreement from AES alone, with real work counters, and shows the protocol's quadratic
  limit". Keep "five generations" true: the prequel is not a generation.
- **Validation contract.** Add rows for the new unit and claims tests, and the new dependency.
- **How to Teach From It.** Add one bullet.
- **Related Demos.** Add `crypto-lab-agreeing-in-public` (the Beginner version of "agree in
  public") and `crypto-lab-grover`.
- **Chip handoff.** Add **Merkle puzzles** and **AES** (implemented). Report whether the catalog
  card copy needs a "prequel" word, under 36 words.

## Do not touch

- The five-generation timeline and its tablist.
- The DH, ECDH, KEM and hybrid engines and their tests.
- The MitM relay and `e2e/mitm-relay.spec.ts`.
- The dark theme pin (`index.html:2`, `:11`), the hidden legacy `#theme-toggle`
  (`src/ui.ts:126–129`, `src/main.ts:27–42`) and the CSS rule that keeps it hidden — deleting
  that rule resurrects a working, persisting toggle (catalog `CLAUDE.md`, "The suppression rule
  is load-bearing"). Also the header and deploy workflow.

## Sources

- Boneh & Shoup, *A Graduate Course in Applied Cryptography*, v0.6, Jan 2023, §10.8, Protocol
  10.1, work O(L) / O(|K|) / O(L·|K|), the L ≈ |K| ≈ 2³⁰ example, and the citation of
  Impagliazzo–Rudich (book.txt lines 20872–20965) — https://toc.cryptobook.us/
- R. C. Merkle, "Secure communications over insecure channels", *Communications of the ACM*
  21(4):294–299, April 1978, DOI 10.1145/359460.359473 (verified via Crossref).
- R. Impagliazzo and S. Rudich, "Limits on the provable consequences of one-way permutations",
  STOC '89, pp. 44–61, DOI 10.1145/73007.73012 (verified via Crossref).
- B. Barak and M. Mahmoody-Ghidary, "Merkle Puzzles Are Optimal — An O(n²)-Query Attack on Any
  Key Exchange from a Random Oracle", CRYPTO 2009, LNCS, pp. 374–390, DOI
  10.1007/978-3-642-03356-8_22 (verified via Crossref; protocol form read at
  https://www.iacr.org/archive/crypto2009/56770369/56770369.pdf).
- G. Brassard, P. Høyer, K. Kalach, M. Kaplan, S. Laplante, L. Salvail, "Merkle Puzzles in a
  Quantum World", CRYPTO 2011 (abstract verified at
  https://iacr.org/conferences/crypto2011/abstracts/385.htm). Seam and one-liner only.
- NIST FIPS 197-upd1 (2023), Appendix B —
  https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197-upd1.pdf
- NIST SP 800-38A (2001), Appendix F.1.1 ECB-AES128.Encrypt —
  https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf
