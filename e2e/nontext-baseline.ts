/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  "control-boundary|a.cl-btn": { ratio: 1.42, required: 3.0, unverified: false },
  "control-boundary|button#dh-attack.tab-button": { ratio: 1.21, required: 3.0, unverified: false },
  "control-boundary|button#ec-walk.tab-button": { ratio: 1.23, required: 3.0, unverified: false },
  "control-boundary|button#gen-tab-dh.gen-pill.is-active": { ratio: 1.15, required: 3.0, unverified: false },
  "control-boundary|button#gen-tab-ecdh.gen-pill": { ratio: 1.19, required: 3.0, unverified: false },
  "control-boundary|button#gen-tab-hybrid.gen-pill": { ratio: 1.19, required: 3.0, unverified: false },
  "control-boundary|button#gen-tab-mlkem.gen-pill": { ratio: 1.19, required: 3.0, unverified: false },
  "control-boundary|button#gen-tab-x25519.gen-pill": { ratio: 1.19, required: 3.0, unverified: false },
  "control-boundary|button#hybrid-run.tab-button": { ratio: 1.23, required: 3.0, unverified: false },
  "control-boundary|button#kem-run.tab-button": { ratio: 1.23, required: 3.0, unverified: false },
  "control-boundary|button#mitm-authrun.tab-button": { ratio: 1.22, required: 3.0, unverified: false },
  "control-boundary|button#mitm-relay.tab-button": { ratio: 1.22, required: 3.0, unverified: false },
  "control-boundary|button#mlwe-resample.tab-button": { ratio: 1.23, required: 3.0, unverified: false },
  "control-boundary|button#mlwe-solve.tab-button": { ratio: 1.23, required: 3.0, unverified: false },
  "control-boundary|button#shor-random-a.tab-button": { ratio: 1.23, required: 3.0, unverified: false },
  "control-boundary|button.copy-chip": { ratio: 1.68, required: 3.0, unverified: false }
};
