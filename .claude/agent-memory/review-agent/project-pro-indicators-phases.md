---
name: pro-indicators-phases
description: Pro-indicators feature is phased; Phase 1 ships calc functions only, not wired into IndicatorResult
metadata:
  type: project
---

Pro-indicators is a multi-phase feature (plans under `docs/superpowers/plans/2026-06-05-pro-indicators-phase1-*`).

**Phase 1** = 12 pure indicator calc functions (`src/domain/indicators/{macdV,connorsRsi,forceIndex,elderRay,elderImpulse,bollingerDerived,chandelierExit,ewmaVolatility,yangZhang,hurst,varianceRatio,regression}.ts`) + `statistics.ts` helper. Deliberately NOT added to `IndicatorResult` / `calculateIndicators` / prompt — those are deferred to Phase 3 (after a Phase 2 validation-harness gate decides which indicators survive). All Phase-1 result types in `domain/types.ts` carry `@internal` and are NOT re-exported via `src/index.ts` — this is correct, not a leak, until Phase 3.

**Why:** Phase 2 runs the validation harness (2yr window) to measure forward edge; only indicators with edge get wired in. Reviewers should NOT flag "calc function exists but isn't in IndicatorResult" as a defect during Phase 1.

**How to apply:** When reviewing pro-indicator calc files, treat missing `IndicatorResult` wiring and `@internal`-but-not-exported types as intended. Phase 1 review priorities (per plan): math correctness vs formulas, divide-by-zero/ln guards, functional style + length-caching, `toBeCloseTo` reference-value tests (CONVENTIONS.md#TE-10), warmup→null.

Related: [[groupb-backtest-near-random]] context — levels/trend have ~zero forward edge, which is why this feature gates on validation before wiring.
