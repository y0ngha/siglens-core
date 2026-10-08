# Fix Log

## fix/pattern-qualification review rounds 1–2

Rule: CONVENTIONS.md#TE-9, #CP-6, #CS-5, FF.md cohesion/predictability

Violation: core review found:
- required: a guard added to block a specific false positive had no near-miss test that fails when the guard is removed (mutation survived)
- required: numeric assertion `toBe(min(|d|, tol))` passes for NaN (Object.is) — use isFinite + toBeLessThanOrEqual
- recommended: ~10 advertised thresholds could be mutated with all tests green — every gate constant needs a near-miss row on each side
- recommended: patterns without an age bound stayed drawable long after the structure ended
- recommended: 1,100-line module holding unrelated family rules (split by family)
- recommended: nested ternary for id selection; constant doc ("min 4") contradicting effective behavior (5); JSDoc duplicating a rule stated on another function

Branch: fix/pattern-qualification

## fix/pattern-qualification-followups review rounds 1–3 + sweep

Rule: TESTING.md#TE-5 #TE-9, CONVENTIONS.md comments, FF.md predictability/coupling

Violation: review + validation sweep found:
- required: prompt Writing Rules contradicted the section intro (fill geometry vs geometry null for unlisted patterns) — restated rules must change together
- required (×2): inserting a declaration between a JSDoc block and its function detached the doc (pivots.ts, flags.ts)
- required: new guards / mirrored branches without a test that fails when only that guard is removed (flag age, double neckline right edge, flag-vs-pennant touch extent)
- recommended: one rule expressed in two places (flag loop cutoff vs isRecent); round-tripping a value through a multiplier
- recommended: committing real vendor bar data with tickers/real timestamps — anonymize (price scale + time shift), compact, dedupe by mutation-kill
- sweep: pivots computed with the last-bar ATR re-zigzagged history (levels flickered under the same id) — use causal per-bar thresholds

Branch: fix/pattern-qualification-followups
