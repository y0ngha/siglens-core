# Pro-Indicators Phase 1 — Indicator Calculations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. One implementer subagent per batch; TDD per indicator; **no commits by implementers** — review-agent (Opus) → mistake-managing-agent → git-agent handle review/commit per repo CLAUDE.md.

**Goal:** Implement 12 professional indicator **calculation functions** as pure domain functions with full unit tests (90% branch, happy + worst case), plus extend the validation harness data window to 2 years. No `IndicatorResult`/prompt wiring yet — that is Phase 3 (after the Phase 2 validation gate decides which indicators survive).

**Architecture:** Each indicator is a pure function in `src/domain/indicators/<name>.ts`, reusing existing primitives (EMA/ATR/MACD/Bollinger/RSI + utils) where possible. Result types live in `src/domain/types.ts`. New constants in `src/domain/indicators/constants.ts`. Exported via `src/domain/indicators/index.ts` (the `export *` barrel) — but NOT added to `calculateIndicators`/`IndicatorResult` (deferred to Phase 3).

**Tech Stack:** TypeScript (strict, functional per CONVENTIONS.md — `map/filter/reduce/Array.from`, no imperative `for`+push or `let`-reassignment unless an O(N²) accumulator is required and justified), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-pro-indicators-design.md` §5. **KAMA is dropped (spec D11).**

**Conventions to follow from the start (cloud review enforces these — see PR #146/#147):**
- Functional style; cache `array.length` in a `const` before any unavoidable loop; no magic literals (extract named consts); `@internal` JSDoc on every export (none are re-exported via `src/index.ts`); types in `domain/types.ts`; same-folder imports relative (`./x`); named direction/enum types over inline unions; explicit return types; warmup entries are `null` (not 0); tests assert computed values (`toBeCloseTo`) not just signs, and cover worst cases (empty / shorter-than-period / NaN·Inf / zero-variance / division-by-zero guards / flat series).

---

## File Structure

```
src/domain/types.ts                 # MODIFY: add @internal result interfaces + enums (see each task)
src/domain/indicators/constants.ts  # MODIFY: add named period/threshold constants
src/domain/indicators/
  macdV.ts  bollingerDerived.ts  connorsRsi.ts  forceIndex.ts
  elderRay.ts  elderImpulse.ts  chandelierExit.ts  yangZhang.ts
  ewmaVolatility.ts  hurst.ts  varianceRatio.ts  regression.ts   # CREATE
  index.ts                          # MODIFY: add `export *` for each new file
src/__tests__/domain/indicators/<name>.test.ts                   # CREATE (one per indicator)
scripts/validation/run.ts           # MODIFY: Task 0 — FROM → 2 years back
```

---

## Task 0 — Extend validation window to 2 years

**Files:** Modify `scripts/validation/run.ts`.

The Phase 0 golden-cross self-test had too few 50/200 crosses in ~13 months (n=0–1/ticker → unreliable t-stat). Widen the window so Phase 2 has adequate samples.

- [ ] Change `const FROM = '2025-05-01';` → `const FROM = '2024-06-05';` (≈2 years before the display end).
- [ ] Keep `const TO = '2026-06-04';` (or update to the current date if running later).
- [ ] No test (config constant). Verified by the Phase 2 smoke run (`--refresh`) producing more golden-cross triggers per ticker.

---

## Implementation batches (subagent-driven)

Dispatch **one implementer per batch**; each implements its indicators TDD, runs `yarn typecheck && yarn lint && yarn test <its test paths>`, self-reviews, does NOT commit.

- **Batch A — momentum (reuse-heavy):** MACD-V, Connors RSI, Force Index, Elder-Ray, Elder Impulse.
- **Batch B — volatility/channel:** Bollinger %B+BandWidth, Chandelier Exit, Yang-Zhang, EWMA.
- **Batch C — statistical/regime (use a capable model):** Hurst, Variance Ratio, Regression slope+R².

---

## Task 1 — MACD-V `macdV.ts`

**Signature:** `export function calculateMacdV(bars: Bar[], fastPeriod = MACD_FAST_PERIOD, slowPeriod = MACD_SLOW_PERIOD, atrPeriod = MACD_V_ATR_PERIOD): (number | null)[]`
**Reuse:** `calculateMACD(bars, fast, slow, signal)` → `.macd` (= EMA_fast − EMA_slow); `calculateATR(bars, atrPeriod)`.
**Formula:** `macdV[i] = (atr[i] != null && atr[i] > 0 && macd[i] != null) ? (macd[i] / atr[i]) * 100 : null`.
**Constants:** `MACD_V_ATR_PERIOD = 26`, `MACD_V_SCALE = 100` (reuse `MACD_FAST_PERIOD`/`MACD_SLOW_PERIOD`).
**Tests:** empty → `[]`; series shorter than slow+atr warmup → all null; a known hand-computed value at the first non-null index; worst: a window where ATR=0 (flat prices) → null (no divide-by-zero); NaN/Inf-free.

## Task 2 — Connors RSI `connorsRsi.ts`

**Signature:** `export function calculateConnorsRsi(closes: number[], rsiPeriod = CRSI_RSI_PERIOD, streakRsiPeriod = CRSI_STREAK_PERIOD, pctRankPeriod = CRSI_PCTRANK_PERIOD): (number | null)[]`
**Reuse:** `calculateRSI(closes, rsiPeriod)`; `calculateRSI(streakSeries, streakRsiPeriod)`.
**Formula:** average of three components where all defined:
1. `RSI(close, 3)`.
2. Streak: signed consecutive-direction count (`+k` after k up-days, `−k` after k down-days, 0 if unchanged); `RSI(streak, 2)`.
3. PercentRank of the 1-day ROC over the last `pctRankPeriod`: `100 * (count of prior ROC < current ROC) / pctRankPeriod`.
`crsi[i] = (rsiClose[i] + rsiStreak[i] + pctRank[i]) / 3` when all three are non-null, else null.
**Constants:** `CRSI_RSI_PERIOD=3`, `CRSI_STREAK_PERIOD=2`, `CRSI_PCTRANK_PERIOD=100`, `CRSI_COMPONENT_COUNT=3`.
**Tests:** empty; shorter than pctRankPeriod → null until ready; hand value on a small crafted series; worst: all-equal closes (streak=0, ROC=0) → no NaN; monotonic up series.

## Task 3 — Force Index `forceIndex.ts`

**Signature:** `export function calculateForceIndex(bars: Bar[], period = FORCE_INDEX_PERIOD): (number | null)[]`
**Reuse:** `computeEMAValues(raw, period)`.
**Formula:** `raw[i] = (close[i] − close[i-1]) * volume[i]` for `i ≥ 1`; EMA-smooth `raw` over `period`. Index 0 and warmup → null.
**Constants:** `FORCE_INDEX_PERIOD=13`.
**Tests:** empty; single bar → all null; hand value; worst: zero-volume bars → 0 contribution (finite); negative price moves → negative force.

## Task 4 — Elder-Ray `elderRay.ts`

**Signature:** `export function calculateElderRay(bars: Bar[], period = ELDER_RAY_PERIOD): ElderRayResult[]`
**Type (`domain/types.ts`):** `@internal interface ElderRayResult { bullPower: number | null; bearPower: number | null }`.
**Reuse:** `calculateEMA(bars, period)`.
**Formula:** `bullPower[i] = ema[i] != null ? high[i] − ema[i] : null`; `bearPower[i] = ema[i] != null ? low[i] − ema[i] : null`.
**Constants:** `ELDER_RAY_PERIOD=13`.
**Tests:** empty → []; warmup nulls = period−1; hand value; worst: NaN-free on flat series.

## Task 5 — Elder Impulse `elderImpulse.ts`

**Signature:** `export function calculateElderImpulse(bars: Bar[], emaPeriod = ELDER_IMPULSE_EMA_PERIOD): (ImpulseColor | null)[]`
**Type:** `@internal type ImpulseColor = 'green' | 'red' | 'blue'`.
**Reuse:** `calculateEMA(bars, emaPeriod)`; `calculateMACD(bars).map(m => m.histogram)`.
**Formula (i ≥ 1, both ema[i],ema[i-1],hist[i],hist[i-1] non-null):** `emaUp = ema[i] > ema[i-1]`, `histUp = hist[i] > hist[i-1]`; `green` if both up, `red` if both down, else `blue`. Else null.
**Constants:** `ELDER_IMPULSE_EMA_PERIOD=13`.
**Tests:** empty; warmup null; a series producing each of green/red/blue (assert the color); worst: equal values → blue (neither strictly up nor down).

## Task 6 — Bollinger %B + BandWidth `bollingerDerived.ts`

**Signature:** `export function calculateBollingerDerived(bars: Bar[], period = BOLLINGER_DEFAULT_PERIOD, stdDev = BOLLINGER_DEFAULT_STD_DEV): BollingerDerivedResult[]`
**Type:** `@internal interface BollingerDerivedResult { pctB: number | null; bandwidth: number | null }`.
**Reuse:** `calculateBollinger(bars, period, stdDev)`.
**Formula:** with band `{upper,middle,lower}`: `width = upper − lower`; `pctB = width > 0 ? (close − lower)/width : null`; `bandwidth = middle !== 0 ? width/middle : null`. Null when band is null.
**Tests:** empty; warmup null; hand value (e.g. close at middle → pctB≈0.5); worst: zero-width band (flat prices) → pctB null, bandwidth 0 or null (guard); no divide-by-zero.

## Task 7 — Chandelier Exit `chandelierExit.ts`

**Signature:** `export function calculateChandelierExit(bars: Bar[], period = CHANDELIER_PERIOD, multiplier = CHANDELIER_ATR_MULT): ChandelierResult[]`
**Type:** `@internal interface ChandelierResult { longStop: number | null; shortStop: number | null; trend: TrendDirection | null }` where `TrendDirection = 'long' | 'short'` (add if not present).
**Reuse:** `calculateATR(bars, period)`; `slidingMax(highs, period)`, `slidingMin(lows, period)`.
**Formula:** `longStop[i] = HH[i] − mult*atr[i]`; `shortStop[i] = LL[i] + mult*atr[i]`. Trend state machine (O(N) accumulator — JUSTIFY in a comment): start `'long'`; if trend `'long'` and `close[i] < longStop[i]` → `'short'`; if `'short'` and `close[i] > shortStop[i]` → `'long'`; else carry. Null while atr/HH/LL null.
**Constants:** `CHANDELIER_PERIOD=22`, `CHANDELIER_ATR_MULT=3`.
**Tests:** empty; warmup null; hand value for stops; a crafted series that flips long→short→long (assert trend); worst: flat prices (atr=0) handled.

## Task 8 — Yang-Zhang volatility `yangZhang.ts`

**Signature:** `export function calculateYangZhang(bars: Bar[], period = YANG_ZHANG_PERIOD): (number | null)[]`
**Formula (rolling window of `period`, needs prevClose so warmup = period):** with log terms per bar (i≥1):
- overnight `o_i = ln(open_i / close_{i-1})`; open-close `c_i = ln(close_i / open_i)`;
- Rogers-Satchell `rs_i = ln(high_i/close_i)·ln(high_i/open_i) + ln(low_i/close_i)·ln(low_i/open_i)`.
Over the window (n = period): `σ²_o = var(o)`, `σ²_c = var(c)` (sample, n−1), `σ²_rs = mean(rs)`; `k = 0.34 / (1.34 + (period+1)/(period−1))`; `σ²_yz = σ²_o + k·σ²_c + (1−k)·σ²_rs`; result `= sqrt(max(0, σ²_yz))`.
**Constants:** `YANG_ZHANG_PERIOD=20`, `YANG_ZHANG_K_NUM=0.34`, `YANG_ZHANG_K_DEN_BASE=1.34`.
**Tests:** empty; shorter than period+1 → null; hand value on a tiny crafted OHLC window (compute expected with the formula); worst: non-positive prices guarded (skip/clamp → no `ln` of ≤0 → null); flat prices → 0 vol.

## Task 9 — EWMA volatility `ewmaVolatility.ts`

**Signature:** `export function calculateEwmaVolatility(closes: number[], lambda = EWMA_LAMBDA): (number | null)[]`
**Formula:** log returns `r_t = ln(close_t/close_{t-1})` (t≥1). Seed `var_1 = r_1²` (first available). `var_t = λ·var_{t-1} + (1−λ)·r_t²`. Result `= sqrt(var_t)`. Index 0 → null. (O(N) recursive accumulator — justify.)
**Constants:** `EWMA_LAMBDA=0.94`.
**Tests:** empty; single close → all null; hand value over 3–4 closes; worst: non-positive close guarded; constant prices → 0.

## Task 10 — Hurst exponent `hurst.ts` (capable model)

**Signature:** `export function calculateHurst(closes: number[], window = HURST_WINDOW): (number | null)[]`
**Formula (rolling rescaled-range R/S over `window`):** for each bar with ≥`window` history, on the window's log-returns: split into sub-series lengths `n ∈ {window/4, window/2, window}` (or a small fixed set ≥ HURST_MIN_SUBWINDOWS); for each `n` compute mean rescaled range `R/S`; Hurst = slope of `log(R/S)` vs `log(n)` via least squares. Clamp to `[0,1]`. Null until `window` history. Document O(window) per bar.
**Constants:** `HURST_WINDOW=100`, sub-window divisors as named consts.
**Tests:** empty; shorter than window → null; a trending series → H>0.5, a mean-reverting (alternating) series → H<0.5 (assert direction, loose bounds); worst: flat series (S=0) guarded → null (no divide-by-zero); value in [0,1].

## Task 11 — Variance Ratio `varianceRatio.ts` (capable model)

**Signature:** `export function calculateVarianceRatio(closes: number[], q = VR_Q, window = VR_WINDOW): (number | null)[]`
**Formula (rolling over `window`):** 1-period log returns `r`; `var1 = var(r)` (sample). q-period overlapping returns `r^q_t = Σ_{j=0}^{q-1} r_{t-j}`; `varQ = var(r^q)`. `VR = varQ / (q · var1)` when `var1 > 0`, else null. Null until `window` history.
**Constants:** `VR_Q=2`, `VR_WINDOW=60`.
**Tests:** empty; shorter than window → null; random-walk-ish series → VR≈1 (loose); trending → VR>1; mean-reverting → VR<1; worst: var1=0 (flat) → null.

## Task 12 — Regression slope + R² `regression.ts` (capable model)

**Signature:** `export function calculateRegression(closes: number[], period = REGRESSION_PERIOD): RegressionResult[]`
**Type:** `@internal interface RegressionResult { slope: number | null; r2: number | null }`.
**Reuse:** the math behind `linreg` (utils) — OLS of `y=closes` on `x=[0..period-1]`.
**Formula:** over the trailing `period`: `slope = (nΣxy − ΣxΣy)/(nΣx² − (Σx)²)`; `r2 = 1 − SS_res/SS_tot` where `SS_tot = Σ(y−ȳ)²`, `SS_res = Σ(y − (intercept+slope·x))²`. `r2 = null` when `SS_tot = 0` (flat → undefined fit). Null until `period` history.
**Constants:** `REGRESSION_PERIOD=20`.
**Tests:** empty; shorter than period → null; perfectly linear series → r2≈1, slope = step; flat series → slope 0, r2 null (guard); worst: no divide-by-zero.

---

## Final Task — Exports + full gate

**Files:** `src/domain/indicators/index.ts`.
- [ ] Add `export * from './<name>';` for all 12 new files (alphabetical with the existing block).
- [ ] Do NOT add them to `calculateIndicators` or `IndicatorResult` (Phase 3).
- [ ] Run `yarn lint && yarn typecheck && yarn test` — all pass; `yarn test --coverage src/__tests__/domain/indicators/<new files>` ≥ 90% branch.

---

## Self-Review (plan author)
- **Spec §5 coverage:** 12 of the 13 §5.2 rows (KAMA dropped per D11; AVWAP calc pre-exists; RS is Phase 4). All have a task.
- **Placeholders:** none — each task has signature + formula + reuse + constants + concrete test cases.
- **Type consistency:** result interfaces (`ElderRayResult`, `BollingerDerivedResult`, `ChandelierResult`, `RegressionResult`, `ImpulseColor`, `TrendDirection`) are defined in `domain/types.ts` and referenced by their files; scalar indicators return `(number|null)[]`.
- **Convention pre-emption:** functional style, length-caching, `@internal`, named types, computed-value test assertions — all called out up front to avoid the PR #146/#147 review churn.

## Follow-up (later phases)
- **Phase 2:** run the harness (2yr window) over these indicators' signals → edge report → user decides signal/advisory/drop.
- **Phase 3:** wire survivors into `IndicatorResult`/`calculateIndicators` + prompt rendering + gating (event SignalTypes / state predicates) + skill docs + consuming-repo edits.
- **Phase 4:** RS / benchmark.
