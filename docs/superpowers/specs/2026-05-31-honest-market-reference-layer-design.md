# Honest Market Reference Layer (Group B redesign) — Design

- **Date:** 2026-05-31
- **Status:** Draft (awaiting user review)
- **Scope:** `siglens-core` (`domain/analysis/`, `domain/types.ts`, prompt builder). Prompt-only consumers (siglens) pick up changes via the published package.
- **Supersedes:** the predictive framing of `computeLevelCandidates`, `computePivotFibLevels`, `computeTrendlineCandidates`, and `classifyTrend` in the chart prompt.

---

## 1. Context & Motivation

We ran extensive walk-forward backtests (10–25 US equities, 6 timeframes, drift-matched + distance-matched random baselines, leakage-free) on the existing Group B computations and on literature/TradingView alternatives. Findings (recorded in memory `groupb-backtest-near-random`):

- **Existing S/R (`computeLevelCandidates`), standard/fib pivots, trendlines, and `classifyTrend` have ~zero honest forward edge** vs distance-matched random across all 6 timeframes.
- **`touchCount` is wrong-signed** (more historical touches → *lower* forward respect). The `#138` strength formula (`sources×2 + touchCount`) is not validated and is mildly counterproductive.
- **Trendlines have negative edge** (worse than random horizontal levels at matched distance).
- **`classifyTrend` (EMA20-slope) carries no directional information** (downtrend forward returns ≥ uptrend at several timeframes).
- Academic methods (time-series momentum, round numbers, volume nodes, regime gating) and the only genuinely-novel TradingView mechanism (Lorentzian kNN) **also fail** honest controls. 2020+ literature (incl. a 2021 study refuting standalone Fibonacci, and 2026 work formalizing ~3.3× backtest inflation) **confirms** that forward S/R/trend prediction on liquid US equities is near-random; nothing crosses from "statistically detectable" to "economically tradable."
- An AI comparison (gemini-2.5-flash-lite) showed AI-derived S/R is also ≈ random and disagrees with our levels ~70% of the time.

**Conclusion:** precise prediction is not achievable; chasing it would add false precision and risk degrading analysis quality. The value of deterministic computation is **(1) determinism**, **(2) saving the AI from arithmetic errors**, **(3) supplying the reference levels/structures market participants actually watch** (salience), not prediction.

---

## 2. Decision & Rationale

Ship an **Honest Market Reference Layer (A)**: a pure, multi-horizon, deterministic computation that surfaces commonly-watched reference levels and **descriptive** trend structure as **advisory context** (numbers only) for the AI — never as forced selections or validated predictors. The AI weighs them alongside its own pattern/skill/SMC reasoning.

This directly satisfies the user's directives:
- Multi-horizon (short/medium/long) S/R **and** trend returned together, computed from `bars` + indicator inputs.
- "Treat our computed values like a skill — advisory, not mandatory."
- Reuse/improve the computation logic we built and validated during the spike.
- Include authoritative, widely-used TradingView indicator logic (implemented deterministically) as reference.
- Re-design the prompt framing away from "compute these and answer based on them."

---

## 3. Goals / Non-Goals

**Goals**
- One pure domain function returning short/medium/long reference per chart analysis.
- Honest, advisory prompt framing; no predictive/authoritative language; no strength ranking based on falsified signals.
- Reuse existing indicators (VP, MA/EMA, Bollinger/Keltner, Donchian, Ichimoku, Supertrend, ADX/DMI, ATR, VWAP, SMC swings, fib, pivots) + implement the authoritative additions (SMC market structure / order blocks / FVG, Anchored VWAP, round numbers, Camarilla pivots).
- No degradation of analysis quality; net prompt size controlled.

**Non-Goals**
- No predictive engine, no ML, no "strength = likelihood of holding" claims.
- No trendline candidates (negative edge) and no `touchCount`/confluence **ranking** as conviction.
- No new I/O; everything stays in `domain/` (pure).
- No changes to non-chart prompts (fundamental/news/options/overall/chatbot) in this work.

---

## 4. Architecture & Contract

New module: `src/domain/analysis/marketReference.ts` (pure). SMC structure helpers in `src/domain/analysis/smc/` (`marketStructure.ts`, `orderBlocks.ts`, `fairValueGap.ts`) or a single `smcStructure.ts` if small.

```ts
// domain — pure, no I/O
export function computeMarketReference(
    bars: readonly Bar[],
    indicators: IndicatorResult,
    timeframe: Timeframe
): MarketReference;

export interface MarketReference {
    short: HorizonReference;
    medium: HorizonReference;
    long: HorizonReference;
}
```

`computeMarketReference` slices `bars` into each horizon window, recomputes window-local structure (VP, swings, fib, AVWAP, structure) and maps global indicators (MAs/EMAs, Ichimoku, Supertrend, Donchian, BB/Keltner, ADX) to the appropriate horizon. It is invoked by `buildAnalysisPrompt` and replaces the three current section builders.

---

## 5. Horizon Definition (lookback windows within the analyzed timeframe)

Per the approved decision (same-timeframe lookback windows, no extra data fetch). Window = trailing N bars (capped at `bars.length`). Indicator periods map to horizons.

| Timeframe | short (bars) | medium (bars) | long (bars) |
|---|---|---|---|
| 1Day | 20 | 60 | 200 |
| 4Hour | 20 | 60 | 180 |
| 1Hour | 24 | 72 | 200 |
| 30Min | 26 | 78 | 200 |
| 15Min | 26 | 78 | 200 |
| 5Min | 24 | 78 | 200 |

Defined in `HORIZON_WINDOWS_BY_TIMEFRAME: Record<Timeframe, { short: number; medium: number; long: number }>` (constants). MA/EMA mapping: **short → EMA9, EMA20**; **medium → MA60 / EMA60**; **long → MA120, MA200**. Each horizon's window-local computations use `bars.slice(-N)`.

---

## 6. Reference Content per Horizon

Each `HorizonReference` carries (all numbers; no claims of predictiveness):

```ts
export interface HorizonReference {
    window: { bars: number; fromTime: number; toTime: number };
    levels: ReferenceLevels;      // S/R reference (bucket 1 + 2)
    structure: TrendStructure;    // descriptive trend facts (bucket 3)
}
```

### 6.1 Bucket 1 — our validated/built logic (reference levels)
- **Fibonacci retracement & extension** from the horizon's most significant swing (kernel-smoothed swing detection — Lo-Mamaysky-Wang 0.3×h Gaussian — for cleaner extrema).
- **Volume Profile** POC / VAH / VAL + **HVN** peaks, computed over the horizon window.
- **Swing highs/lows** (confirmed, kernel-smoothed) within the window.
- **Key moving averages** for the horizon (short EMA9/20, medium MA60, long MA200) as dynamic levels.
- **Round numbers** nearest above/below current price (tiered increment: `<5→0.5`, `5–50→1`, `50–200→5`, `>200→10`; whole-dollar always included).

### 6.2 Bucket 2 — authoritative TradingView indicator logic (implemented deterministically)
Already in `IndicatorResult` (wire-only): **Supertrend**, **Ichimoku** (Kumo top/bottom = dynamic S/R), **Donchian** channel, **Bollinger** & **Keltner** bands, **ADX/DMI**, **VWAP**.
New implementations (pure, OHLCV-derived, non-repainting):
- **Anchored VWAP** — anchored to the horizon's most significant swing high and swing low. `AVWAP = Σ(typical·vol)/Σ(vol)` from anchor, `typical=(h+l+c)/3`.
- **Camarilla pivots** (prior period H/L/C): `R3=C+(H−L)·1.1/4`, `R4=C+(H−L)·1.1/2`, `S3=C−(H−L)·1.1/4`, `S4=C−(H−L)·1.1/2` (the four most-watched). Standard pivots (PP/R1–R3/S1–S3) retained as reference.
- **SMC Market Structure** (BOS / CHoCH) — from confirmed swings: a close beyond the last protected swing in the prevailing direction = **BOS** (continuation); a close beyond the opposite protected swing = **CHoCH** (structural shift). Output: last BOS `{level, direction, time}`, last CHoCH `{level, direction, time}`, current structural bias.
- **SMC Order Blocks** — last opposite-color candle before an impulsive move that produces a BOS. Output: zone `{high, low, direction, time, mitigated}`.
- **SMC Fair Value Gaps** — 3-candle imbalance (bullish: `bar[i−1].high < bar[i+1].low`; bearish: mirror). Output: `{top, bottom, direction, time, filled}`, unfilled gaps near price prioritized.

> **Honesty constraint on Zeiierman "Ranked S&R Zones":** we implement zone *detection* (price range, volume-at-zone, swing-touch count, mitigation) and expose them as **descriptive attributes only**. We do **not** compute or surface a composite "strength score" as conviction, because its core input (`touchCount`) is empirically wrong-signed.

### 6.3 Bucket 3 — descriptive trend structure (NOT direction prediction)
```ts
export interface TrendStructure {
    priceVsMA: { ma50: 'above' | 'below'; ma200: 'above' | 'below' };
    emaStack: 'aligned_up' | 'aligned_down' | 'mixed';
    swingStructure: 'HH_HL' | 'LH_LL' | 'mixed'; // Dow structure from swings
    adx: number;                  // trend strength magnitude
    efficiencyRatio: number;      // Kaufman ER 0..1 over the horizon window
    regime: 'trending' | 'ranging'; // descriptive: ADX>25 (or ER>0.3) → trending
}
```

---

## 7. Removed / Changed (false-precision removal)

- ❌ **`touchCount`/confluence strength ranking** as conviction → removed. (Multiple-source *labeling* may remain as descriptive info, not a rank.)
- ❌ **Precomputed trendline candidates** (`computeTrendlineCandidates`, `## Trendline Candidates` section, the "SELECT from these" instruction) → **deleted**. NOTE: the AI's own `trendlines` *output* (response schema + siglens rendering) is **retained** — we only stop feeding it precomputed candidates; the AI still draws trendlines it visually identifies.
- ➕ **`TrendStructure`** is a **new, additive** descriptive trend section in the chart prompt (the chart prompt currently injects no `classifyTrend` output). `classifyTrend` itself is **out of scope** — it feeds `dashboard.ts`/signals, not the chart prompt, and is left untouched.
- **Deleted entirely** (not deprecated, per user decision): `computeLevelCandidates` (+ `LevelCandidate`/`LevelCandidates` types), `computePivotFibLevels` (+ `PivotFibLevels` type), `computeTrendlineCandidates`, `extendTrendline`, and their now-unused files. Reusable math (fib projection, volume-profile, swing detection) is moved/shared into `marketReference.ts`, not duplicated.

---

## 8. Output Types (additions to `domain/types.ts`)

`MarketReference`, `HorizonReference`, `ReferenceLevels`, `ReferenceLevel` (`{ price, label, kind }` where `kind ∈ 'fib'|'vp'|'swing'|'ma'|'round'|'pivot'|'camarilla'|'ichimoku'|'donchian'|'band'|'avwap'`), `TrendStructure`, `MarketStructureSignal`, `OrderBlock`, `FairValueGap`. All fields `required`, `additionalProperties:false`-friendly for any schema use; nullable via `T | null` where a horizon lacks data (short series). Drift-guard test mirrors existing convention.

---

## 9. Prompt Redesign (Q3 — replace two sections + reframe)

**Remove** these section builders/usages in `prompt.ts`:
- `## Support/Resistance Candidates (precomputed)` (`formatLevelCandidatesSection`, `SR_CANDIDATES_HEADER`, the "Ranked by strength … strongest first" framing at L651).
- `## Pivot & Fibonacci Levels (precomputed)` (`formatPivotFibSection`, `PIVOT_FIB_HEADER`).
- `## Trendline Candidates (precomputed)` (`TRENDLINE_CANDIDATES_HEADER`, L734 "SELECT from these … verbatim").

**Add** one section: `## Market Reference (deterministic · advisory)` rendering short/medium/long reference compactly (levels grouped support/resistance with `label`; trend structure as a one-line descriptor per horizon).

**Honest framing line** (replaces the authoritative tone):
> "The values below are a deterministic computation of reference levels and structure that market participants commonly watch. They are **not** validated forward predictors — backtesting shows precise level/trend prediction is near-random. Use them as *context* to weigh alongside detected patterns, skills, and your own reasoning; never treat them as guarantees. You may identify additional or better support/resistance from patterns, SMC, and volume that these references do not cover."

**Reframe** the keyLevels guidance (L873): drop "Candidates with more confluent sources and more tests are higher-conviction; prefer them." Replace with advisory wording: keyLevels may *draw on* the reference levels (use exact numbers to avoid arithmetic error) **or** be derived by the AI from patterns/structure with stated justification — neither is mandatory.

**Reframe** `FIELD_GUIDANCE_PREFACE` (L841) and the S/R Tool-Guide lines (L1086–1090) so they reference the new section and the advisory framing (still "use exact provided numbers rather than recomputing arithmetic," but without "answer based on these" authority).

Net size: the single multi-horizon reference replaces three sections; framing is one short paragraph. Target ≤ current combined size (curation + compact rendering).

---

## 10. Public API / Migration (delete old, replace with new — per user decision)

- **New exports:** `computeMarketReference` + types, classified per `docs/PUBLIC_API.md` tiers; SMC structure helpers `@internal` unless needed externally.
- **Delete:** remove the public exports of `computeLevelCandidates` and `computePivotFibLevels` from `src/index.ts` and `src/index.client.ts`; delete `computeTrendlineCandidates`/`extendTrendline` (internal). Delete `levelCandidates.ts`, `pivotFib.ts`'s public orchestrators, `trendlineCandidates.ts`, `trendline.ts`, and the input-only types `LevelCandidate`, `LevelCandidates`, `PivotFibLevels`.
- **Keep:** `classifyTrend` (dashboard/signals consumer — out of scope) and the **response** types `Trendline`/`TrendlinePoint`/`TrendlineDirection` (AI output schema, rendered by siglens).

### Versioning — handled by the user (DO NOT bump)
Version + CHANGELOG are owned by `release-it`/conventional-changelog and the **user performs the version bump**. Therefore implementation PRs **must NOT**:
- add a `BREAKING CHANGE:` commit footer (even though export removal is technically breaking), or
- manually edit `package.json` `version` / `CHANGELOG.md`.

Use normal conventional-commit messages (`feat:` / `refactor:` / `chore:`) **without** breaking-change footers. The user decides and triggers the release/version bump separately.

### Consumer impact — verified ZERO code changes required
Cross-repo grep (`siglens`, `siglens-worker`, `siglens-trader`) confirms:
- None of the deleted functions (`computeLevelCandidates`, `computePivotFibLevels`, `computeTrendlineCandidates`, `extendTrendline`) are referenced by any consumer — they are core-internal prompt inputs.
- The only consumer references are to the **retained** response types `Trendline`/`TrendlineDirection` (`siglens/src/shared/lib/trendline.ts`, `siglens/src/widgets/analysis/AnalysisPanel.tsx`) — unaffected.

So this is a clean removal in core with no consumer edits and no version bump by us. Sync `docs/PUBLIC_API.md` and `docs/DOMAIN.md`. (If a future change touches the retained `Trendline` response shape, re-run the consumer cross-check first.)

---

## 11. Testing

- Unit tests per computation (horizon slicing, fib from swing, window VP, AVWAP, Camarilla formula, round-number tiers, SMC BOS/CHoCH/OB/FVG detection, ER, structure classification) — domain 90% branch target.
- Prompt formatting tests: new section present with advisory framing; old three sections absent; keyLevels guidance no longer claims "more tests = higher conviction."
- Drift-guard tests for new types (Required<T> fixtures + enum exhaustiveness where unions exist).
- No mocks (pure functions).

---

## 12. Phasing / PR Split (Q4)

- **PR1 — Core reference layer + prompt swap (shippable MVP).** `computeMarketReference` wiring existing indicators (VP, fib, swings, MAs, Ichimoku, Supertrend, Donchian, BB/Keltner, ADX, VWAP) + round numbers + Camarilla + `TrendStructure` (ER/regime/structure). Replace the three prompt sections with the advisory `## Market Reference` section + reframed guidance. Drop touchCount ranking + trendline. Deprecate old exports. **Delivers value alone.**
- **PR2 — SMC enrichment.** Market Structure (BOS/CHoCH), Order Blocks, FVG, Anchored VWAP added to the reference layer + section. (Split into PR2a/2b if SMC review surface is large.)

Each PR: implementation → review-agent loop → claude-code-review (Blockers + Suggestions) → merge (`--merge`).

---

## 13. Risks & Mitigations

- **Prompt bloat / quality** → curate (most-watched, non-redundant), compact numeric rendering, measure tokens, empirically verify quality (floor models) before merge, per prior practice.
- **Over-anchoring by the AI** → honest framing explicitly demotes references to context and invites AI-derived levels.
- **SMC detection complexity / repaint** → use only confirmed swings (no look-ahead); unit-test BOS/CHoCH/OB/FVG against fixtures.
- **Multiple-source labeling mistaken for ranking** → present as descriptive labels, not ordered conviction.

---

## 14. Open Questions

- Exact compact rendering format of the `## Market Reference` section (one block per horizon vs interleaved) — finalize during PR1 with a token measurement.
- Whether `long` horizon should cap at `bars.length` or require a minimum (skip long horizon when insufficient history) — propose: emit `null`-marked horizon when window > available bars, AI told it's unavailable.
