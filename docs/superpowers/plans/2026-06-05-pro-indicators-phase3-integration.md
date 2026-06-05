# Pro-Indicators Phase 3 — Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD for domain/prompt/gating code. Implementer does NOT commit (review-agent Opus → mistake-managing → git-agent). Research source: `docs/superpowers/research/2026-06-05-pro-indicators-phase3-research.md`. Decision basis: `scripts/validation/reports/indicator-edge.md` + memory `proindicators-phase2-edge-decision`.

**Goal:** Surface the 12 validated Phase 1 pro-indicators in the analysis pipeline — wired into `calculateIndicators`/`IndicatorResult`, rendered in the prompt as a **regime/volatility lens (before indicator values) + a pro-indicator confluence panel (after) with inline measured-reliability annotations**, with Bollinger %B as the one event-gated mean-reversion signal and the other 11 state-gated; plus 12 research-backed skill docs and the consuming-repo (siglens) gating/catalog/progress updates.

**Architecture:** Two parts. **Part A (siglens-core, this worktree):** types → calc wiring → Bollinger %B detector+SignalType → prompt sections → state-gating predicate extensions → tests. One PR. **Part B (siglens consuming repo):** 12 skill.md + SIGNAL_CATALOG + ANALYSIS_PHASES + validate-skills. Separate worktree/PR, depends on Part A's new SignalTypes/state-features being merged.

**Classification (Phase 2 decision, user-approved):**
- **event signal:** Bollinger %B (mean-reversion; daily-short is the measured edge).
- **state-gated advisory:** MACD-V, Connors RSI, Force Index, Elder-Ray, Elder Impulse, Chandelier (directional confluence); Hurst, Variance Ratio, Regression R² (regime); Yang-Zhang, EWMA (volatility/risk).
- **drop:** none.

**Prompt placement (user-approved "regime lens first + integrated panel"):** assembly order gains two new sections —
`… formatBuySellVolumeSection, formatRegimeContextSection (NEW lens), formatIndicatorSection, formatProIndicatorSection (NEW confluence panel), formatSMCSection, …`

---

# PART A — siglens-core

Worktree: `/Users/y0ngha/Project/siglens-core/.claude/worktrees/feat+pro-indicators-phase3` (branch `worktree-feat+pro-indicators-phase3`, off main @ 9fa39b8). `yarn` only. Domain = pure/functional; explicit return types; `@internal`; named constants; tests 90% branch (happy+worst); `yarn typecheck` runs root CJS + scripts ESM.

## Task A1 — IndicatorResult fields + calculateIndicators wiring

**Files:** `src/domain/types.ts` (IndicatorResult), `src/domain/indicators/index.ts` (calculateIndicators), test `src/__tests__/domain/indicators/index.test.ts` (or the existing calculateIndicators test).

- [ ] **Step 1 — verify each calc signature first.** Read each impl to confirm arg (bars vs closes) and return type: `calculateMacdV(bars)→(number|null)[]`, `calculateConnorsRsi(closes:number[])→(number|null)[]`, `calculateForceIndex(bars)→(number|null)[]`, `calculateElderRay(bars)→ElderRayResult[]`, `calculateElderImpulse(bars)→(ImpulseColor|null)[]`, `calculateBollingerDerived(bars)→BollingerDerivedResult[]`, `calculateChandelierExit(bars)→ChandelierResult[]`, `calculateYangZhang(bars)→(number|null)[]`, `calculateEwmaVolatility(bars or closes)→(number|null)[]`, `calculateHurst(closes:number[])→(number|null)[]`, `calculateVarianceRatio(closes or bars)→(number|null)[]`, `calculateRegression(bars or closes)→RegressionResult[]`. Use the actual arg each expects.

- [ ] **Step 2 — add 12 fields to `IndicatorResult`** (after `squeezeMomentum`), each with a one-line JSDoc, types from `@/domain/types` (ElderRayResult, ImpulseColor, BollingerDerivedResult, ChandelierResult, RegressionResult already exist):
```ts
    /** MACD-V (volatility-normalized MACD) per bar. */
    macdV: (number | null)[];
    /** Connors RSI composite per bar. */
    connorsRsi: (number | null)[];
    /** Elder Force Index (EMA-smoothed) per bar. */
    forceIndex: (number | null)[];
    /** Elder-Ray bull/bear power per bar. */
    elderRay: ElderRayResult[];
    /** Elder Impulse System color per bar. */
    elderImpulse: (ImpulseColor | null)[];
    /** Bollinger %B + BandWidth per bar. */
    bollingerDerived: BollingerDerivedResult[];
    /** Chandelier Exit stops + trend per bar. */
    chandelierExit: ChandelierResult[];
    /** Yang-Zhang volatility per bar. */
    yangZhang: (number | null)[];
    /** EWMA (RiskMetrics) volatility per bar. */
    ewmaVolatility: (number | null)[];
    /** Hurst exponent (rolling R/S) per bar. */
    hurst: (number | null)[];
    /** Variance ratio (rolling) per bar. */
    varianceRatio: (number | null)[];
    /** Rolling linear-regression result (slope/r²) per bar. */
    regression: RegressionResult[];
```
- [ ] **Step 3 — wire into `calculateIndicators` return** (after `squeezeMomentum`), reusing `closes` where the function takes closes:
```ts
        macdV: calculateMacdV(bars),
        connorsRsi: calculateConnorsRsi(closes),
        forceIndex: calculateForceIndex(bars),
        elderRay: calculateElderRay(bars),
        elderImpulse: calculateElderImpulse(bars),
        bollingerDerived: calculateBollingerDerived(bars),
        chandelierExit: calculateChandelierExit(bars),
        yangZhang: calculateYangZhang(bars),
        ewmaVolatility: calculateEwmaVolatility(bars), // adjust if it takes closes
        hurst: calculateHurst(closes),
        varianceRatio: calculateVarianceRatio(closes), // adjust per signature
        regression: calculateRegression(bars),         // adjust per signature
```
  Update the function's JSDoc summary list to mention the pro-indicators. Remove the "Intentionally NOT wired" comment block in `index.ts` (lines ~52-54) since they are now wired.
- [ ] **Step 4 — test.** Extend the calculateIndicators test: assert every new key is present and is an array of the bars' length (use a fixture of ≥ longest-warmup bars, e.g. 260, so values are non-null at the tail). Worst case: empty bars → every new field is `[]`.
- [ ] **Verify:** `yarn lint`, `yarn typecheck`, `yarn test`.

## Task A2 — Bollinger %B event signal (SignalType + detectors + register)

**Files:** `src/domain/types.ts` (ConfirmedSignalType), `src/domain/signals/confirmed.ts` (two detectors), `src/domain/signals/index.ts` (import + DETECTORS), `src/domain/indicators/constants.ts` (already has PCTB_OVERSOLD=0.05, PCTB_OVERBOUGHT=0.95), test `src/__tests__/domain/signals/confirmed.test.ts`.

- [ ] **Step 1 — add two members to `ConfirmedSignalType`:** `'bollinger_percentb_oversold'` (bullish), `'bollinger_percentb_overbought'` (bearish).
- [ ] **Step 2 — detectors** in `confirmed.ts` (mirror `detectBollingerLowerBounce` style; causal cross on the `pctB` series from `indicators.bollingerDerived`). Use a `CROSS_LOOKBACK_BARS`-style last-bar check:
```ts
/** @internal %B crossing up through PCTB_OVERSOLD on the last bar (bullish mean-reversion). */
export function detectBollingerPercentBOversold(
    _bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const d = indicators.bollingerDerived;
    if (d.length < 2) return null;
    const i = d.length - 1;
    const prev = d[i - 1].pctB;
    const cur = d[i].pctB;
    if (prev === null || cur === null) return null;
    if (prev <= PCTB_OVERSOLD && cur > PCTB_OVERSOLD) {
        return { type: 'bollinger_percentb_oversold', direction: 'bullish', phase: 'confirmed', detectedAt: i };
    }
    return null;
}
/** @internal %B crossing down through PCTB_OVERBOUGHT on the last bar (bearish mean-reversion — the validated daily-short edge). */
export function detectBollingerPercentBOverbought(
    _bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const d = indicators.bollingerDerived;
    if (d.length < 2) return null;
    const i = d.length - 1;
    const prev = d[i - 1].pctB;
    const cur = d[i].pctB;
    if (prev === null || cur === null) return null;
    if (prev >= PCTB_OVERBOUGHT && cur < PCTB_OVERBOUGHT) {
        return { type: 'bollinger_percentb_overbought', direction: 'bearish', phase: 'confirmed', detectedAt: i };
    }
    return null;
}
```
  Import PCTB_OVERSOLD/PCTB_OVERBOUGHT from `@/domain/indicators/constants` (or the local constants path confirmed.ts uses). Verify `BollingerDerivedResult` has a `pctB` field (it does).
- [ ] **Step 3 — register** both in `src/domain/signals/index.ts` (import block alphabetical + push into DETECTORS).
- [ ] **Step 4 — tests** (worst cases): <2 bars → null; null pctB neighbour → null; no cross → null; oversold up-cross → bullish signal at correct index; overbought down-cross → bearish; value touching exactly the bound then crossing (boundary semantics: prev<=lo && cur>lo).
- [ ] **Verify:** `yarn lint`, `yarn typecheck`, `yarn test`.

## Task A3 — Prompt: regime/volatility lens + pro-indicator confluence panel

**Files:** `src/domain/analysis/prompt.ts` (two new formatters + assembly), `src/domain/analysis/constants.ts` or prompt-local constants (annotation strings + thresholds), test `src/__tests__/domain/analysis/prompt.test.ts`.

Design — inline **measured-reliability annotations** are the "신뢰도 가중치" in the prompt. Define named annotation constants (no magic strings), e.g.:
```ts
const RELIABILITY_NOTE = {
    bollingerPctB: '{signal: daily short mean-reversion — modest measured edge, require confirmation}',
    advisory: '{advisory: no standalone edge measured — use as confluence}',
    impulse: '{permission gate: green=longs only, red=shorts only, blue=both}',
    chandelier: '{risk context: trailing stop / trend regime — not an entry}',
    regime: '{regime lens: weight directional reads by this}',
    volatility: '{risk context: sizing / stop distance / follow-through}',
} as const;
```

- [ ] **Step 1 — `formatRegimeContextSection(indicators, config)` → `## Market Regime & Risk Context`** (the lens). Compute last non-null Hurst, Variance Ratio, Regression (slope+r²), Yang-Zhang, EWMA. Render a Regime line (classify trending/mean-reverting/random from H vs 0.5, VR vs 1, r² vs a windowed-significance note) with explicit weighting guidance, and a Volatility line (YZ + EWMA level, expanding/contracting via `detectTrend`) with risk implication. Use the `regime`/`volatility` reliability notes. Handle all-null warmup gracefully (omit a sub-line or show `N/A`).
- [ ] **Step 2 — `formatProIndicatorSection(indicators, config)` → `## Pro-Indicator Confluence`**. Render, each with its reliability note: Bollinger %B (pctB value + oversold/overbought label using PCTB bounds), MACD-V (value + lifecycle zone vs ±150/±50/0), Connors RSI (value + <10/>90 label), Force Index (value + sign + trend), Elder-Ray (bull/bear power), Elder Impulse (latest color + recent flip), Chandelier (active stop + trend). Reuse `fmt`, `lastOf`, `lastNonNull`, `detectTrend`, `trendLabel`.
- [ ] **Step 3 — assembly:** insert `formatRegimeContextSection(indicators, config)` immediately BEFORE `formatIndicatorSection(...)` and `formatProIndicatorSection(indicators, config)` immediately AFTER it in `buildAnalysisPrompt`'s `sections` array.
- [ ] **Step 4 — tests:** with a ≥260-bar fixture, assert both section headers appear, that the Bollinger %B line carries the signal note, that an advisory line carries the advisory note, and (worst case) that an empty/short-bars fixture does not throw and renders `N/A`/omits cleanly. Assert ordering: `## Market Regime & Risk Context` index < `## Indicator Values` index < `## Pro-Indicator Confluence` index in the built prompt.
- [ ] **Verify:** `yarn lint`, `yarn typecheck`, `yarn test`.

## Task A4 — State-gating predicate extensions (11 advisory/regime/vol features)

**Files:** `src/domain/types.ts` (`SkillStateFeature` union + maybe `SkillStatePredicateKind`), `src/domain/analysis/skillGatingPredicates.ts` (evaluators + named thresholds), test `src/__tests__/domain/analysis/skillGatingPredicates.test.ts`.

- [ ] **Step 1 — extend `SkillStateFeature`** with: `'macdV' | 'connorsRsi' | 'forceIndex' | 'elderRay' | 'elderImpulse' | 'chandelier' | 'hurst' | 'varianceRatio' | 'regression' | 'yangZhang' | 'ewma'`.
- [ ] **Step 2 — add named thresholds** (no magic literals; reuse `MACDV_OVERSOLD/OVERBOUGHT`, `CRSI_OVERSOLD/OVERBOUGHT`, `PCTB_*` where applicable) and per-feature evaluators returning "notable":
  - `macdV` (`level`): |value| ≥ |MACDV_OVERBOUGHT| i.e. in ±150 risk zone (notable).
  - `connorsRsi` (`level`): value ≤ CRSI_OVERSOLD or ≥ CRSI_OVERBOUGHT.
  - `forceIndex` (`level`): sign flip vs previous bar (notable momentum turn). [custom: read last two values]
  - `elderRay` (custom): bullPower > 0 turning or bearPower < 0 turning — fire when |bullPower| or |bearPower| beyond a small ATR-scaled margin, OR simply when bear power is negative-but-rising / bull power positive-but-falling (use last two bars).
  - `elderImpulse` (custom): latest color ≠ 'blue' OR a flip vs previous bar (notable permission change).
  - `chandelier` (custom): trend flip within the last `CROSS_LOOKBACK`-style window.
  - `hurst` (`level`): |H − 0.5| ≥ a named `HURST_DECISIVE_MARGIN` (e.g. 0.1).
  - `varianceRatio` (`level`): |VR − 1| ≥ a named `VR_DECISIVE_MARGIN`.
  - `regression` (custom): r² ≥ a windowed `REGRESSION_R2_SIGNIFICANT` (document that a fixed cutoff is a simplification of the window-scaled critical-R² table; pick a conservative value for the default regression window and cite the research doc).
  - `yangZhang`/`ewma` (custom): current vol in the top/bottom decile of its recent window, OR expanding/contracting via slope — fire when "vol regime is notable" (extreme or fast-changing).
  Wire these into the predicate dispatcher (the switch on `feature`/`predicate`). Add a `'level'`-style generic reader where the feature is a simple `(number|null)[]` (macdV, connorsRsi, hurst, varianceRatio) and custom evaluators for the structured/sequence ones.
- [ ] **Step 3 — tests (per feature, happy+worst):** notable above hi / below lo / inside bounds → false / null-latest → false; for the custom ones, flip-detected vs no-flip, color non-blue vs blue, r² above/below cutoff.
- [ ] **Verify:** `yarn lint`, `yarn typecheck`, `yarn test`.

## Task A5 — Part A integration verification
- [ ] `yarn lint && yarn typecheck && yarn test --coverage` — all pass; new domain code ≥90% branch. Confirm `calculateIndicators` returns 36 keys (24 + 12). Confirm built prompt contains the two new sections in the correct order. Implementer does NOT commit.

---

# PART B — siglens (consuming repo)

Repo: `/Users/y0ngha/Project/siglens` (separate git repo). Create its own worktree/branch + PR. **Depends on Part A merged** (new SignalTypes + SkillStateFeatures must exist in the published/linked `@y0ngha/siglens-core` types for the exhaustiveness guard + skill validation to pass). Sequence: merge Part A, bump/refresh the core dependency in siglens (or rely on the workspace link), then do Part B.

## Task B1 — 12 skill markdown docs

**Files:** `skills/indicators/{macd-v,connors-rsi,force-index,elder-ray,elder-impulse,bollinger-percent-b,chandelier-exit,hurst,variance-ratio,regression-r2,yang-zhang,ewma-volatility}.md`.

Author each from the research doc (`docs/superpowers/research/2026-06-05-pro-indicators-phase3-research.md`), following the EXACT existing format (see `skills/indicators/rsi.md`): frontmatter (`name`, `description` Korean, `type: indicator_guide`, `indicators: ['<key>']`, `confidence_weight`, `gating`, `token_cost: 0`) + body (`## Overview`, `## Signal Interpretation`, `## Recommended Combinations`, `## Caveats`). Each body MUST include: origin/author + paper/award citation; principle & formula; signals detected; **a measured-reliability note reflecting our Phase 2 result (신뢰도 가중치)**; confluence guidance. Use the `confidence_weight` column from the research doc's summary table.

Gating per doc:
- [ ] `bollinger-percent-b.md` — `gating: {tier: gated, signal_kind: event, triggers: [bollinger_percentb_oversold, bollinger_percentb_overbought]}`. Body: %B + BandWidth; stress daily-short is the measured edge, oversold-long weaker; Bollinger's "tags not signals" caveat. `confidence_weight: 0.55`.
- [ ] `macd-v.md` — `gating: {tier: gated, signal_kind: state, state: {feature: macdV, predicate: level}}`. weight 0.4.
- [ ] `connors-rsi.md` — state, `{feature: connorsRsi, predicate: level}`. weight 0.4.
- [ ] `force-index.md` — state, `{feature: forceIndex, predicate: level}`. weight 0.4.
- [ ] `elder-ray.md` — state, `{feature: elderRay, predicate: level}`. weight 0.45.
- [ ] `elder-impulse.md` — state, `{feature: elderImpulse, predicate: level}`. weight 0.45. Body: the censorship/permission framing (green=no shorting, red=no buying, blue=both).
- [ ] `chandelier-exit.md` — state, `{feature: chandelier, predicate: level}`. weight 0.35. Body: trailing-stop/regime, NOT entry.
- [ ] `hurst.md` — state, `{feature: hurst, predicate: level}`. weight 0.4. Body: regime conditioner + R/S small-sample bias caveat.
- [ ] `variance-ratio.md` — state, `{feature: varianceRatio, predicate: level}`. weight 0.5.
- [ ] `regression-r2.md` — state, `{feature: regression, predicate: level}`. weight 0.45. Body: direction-blind, window-scaled significance.
- [ ] `yang-zhang.md` — state, `{feature: yangZhang, predicate: level}`. weight n/a→omit or 0.3 (measurement). Body: risk/measurement only.
- [ ] `ewma-volatility.md` — state, `{feature: ewma, predicate: level}`. weight 0.3 (measurement).

(If the `gating` schema requires `hi`/`lo` for `predicate: level`, omit to use the named defaults from `skillGatingPredicates.ts`, matching how existing state skills rely on defaults.)

## Task B2 — SIGNAL_CATALOG + validate-skills
**File:** `scripts/validate-skills.ts`.
- [ ] Add `'bollinger_percentb_oversold'`, `'bollinger_percentb_overbought'` to `SIGNAL_CATALOG` (keep it `satisfies readonly SignalType[]`; the exhaustiveness guard `MissingSignal` must stay `never`).
- [ ] Run `yarn validate:skills` (or the project's skill-validation command) — the new skill docs' triggers/state features must validate against core's `SignalType` / `SkillStateFeature`.

## Task B3 — ANALYSIS_PHASES progress strings
**File:** `src/widgets/symbol-page/hooks/useAnalysisProgress.ts`.
- [ ] Update line 8 `'20개 이상의 보조지표 시그널 분석 중'` → reflect the new count (now 36 indicators) e.g. `'30개 이상의 보조지표 시그널 분석 중'`. Update line 10 skill count if the gated-skill inventory crossed a round threshold (verify the actual count; only change if warranted).

## Task B4 — Part B verification
- [ ] siglens typecheck/build/lint + skill validation pass. Confirm the exhaustiveness guard compiles (core SignalType ⊇ catalog) and every new skill's `gating` parses.

---

## Notes
- Functional style, `@internal`, named constants, computed-value tests, `@/` cross-folder / relative same-folder — the conventions the cloud review enforces (PR #146–149).
- The reliability annotations in the prompt + the `confidence_weight`/Caveats in skill docs are the empirical "신뢰도 가중치" — they must reflect the measured Phase 2 nulls (advisory) and the modest Bollinger %B edge, NOT textbook enthusiasm.
- Part A and Part B are separate PRs (different repos). Execute A → review → PR → merge first; then B (its triggers/features depend on A's merged types).
- Verify exact calc signatures and result-type field names before wiring (Task A1 Step 1) — do not assume.
