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

## feat/agent-writing-style review rounds 1–2 + A/B

Rule: FF.md predictability, CONVENTIONS.md change synchronization, TESTING.md (assert behavior)

Violation: review + real-LLM A/B found:
- recommended: shipped prompt text drifted from the A/B-tested text (a clause dropped while porting) — ship the measured text or re-measure the shipped text
- recommended: an English-only example ("Source: …") inside a rule meant for all non-Korean languages read as a literal instruction for ja/zh
- recommended: prompt-example test only restated the string; round-trip the example through the real parser instead
- recommended: AGENT_PROMPT_VERSION bump without a PUBLIC_API changelog row
- A/B: re-measuring the shipped text exposed a politeness-mixing regression (4/28 answers) and Korean follow-up chips in English answers — fixed with explicit ending examples and a "write follow-ups in the answer language" clause

Branch: feat/agent-writing-style
