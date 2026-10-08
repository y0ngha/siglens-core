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
