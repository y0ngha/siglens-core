# Pro-Indicators Phase 2 — Empirical Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD for the pure domain helpers; implementer does NOT commit (review-agent Opus → mistake-managing → git-agent).

**Goal:** Measure the forward-edge of each Phase 1 indicator's standard signal across the 10 backtest tickers × 3 timeframes × multiple horizons (2-year window), and produce a per-indicator report so the user can decide **signal / advisory / drop** for each. This is the Phase 2 decision gate.

**Architecture:** Generic, pure trigger helpers live in `src/domain/validation/` (tested). The per-indicator signal definitions + the FMP run + report live in `scripts/validation/` (dev tooling). Reuses Phase 0's `computeForwardEdge` and the 2-year cached bars.

**Spec:** `docs/superpowers/specs/2026-06-04-pro-indicators-design.md` §3.2, §4.3–4.4.

---

## Scope

- **7 directional indicators get a forward-edge test** (bullish + bearish triggers → `computeForwardEdge('up'|'down')`): MACD-V, Connors RSI, Force Index, Elder-Ray, Elder Impulse, Chandelier Exit, Bollinger %B.
- **3 regime indicators (Hurst, Variance Ratio, Regression R²)** are NOT directional signals — the report notes them as conditional filters (a follow-up sub-step can test "does a reference signal's edge improve when filtered by the regime?"). Not in this pass's forward-edge table.
- **2 measurement indicators (Yang-Zhang, EWMA volatility)** are risk/measurement, not directional — no edge test; the report notes their theoretical justification.

## Signal definitions (documented for the user's decision)

| Indicator | series used | bullish trigger | bearish trigger |
|---|---|---|---|
| MACD-V | `calculateMacdV` | cross UP through `−MACDV_OVERSOLD` (−150) | cross DOWN through `+MACDV_OVERBOUGHT` (+150) |
| Connors RSI | `calculateConnorsRsi` | cross UP through `CRSI_OVERSOLD` (10) | cross DOWN through `CRSI_OVERBOUGHT` (90) |
| Force Index | `calculateForceIndex` | cross UP through 0 | cross DOWN through 0 |
| Elder-Ray | `calculateElderRay` (bull/bear power) | bullPower cross UP through 0 | bearPower cross DOWN through 0 |
| Elder Impulse | `calculateElderImpulse` | flip TO `'green'` | flip TO `'red'` |
| Chandelier | `calculateChandelierExit` (trend) | trend flip TO `'long'` | trend flip TO `'short'` |
| Bollinger %B | `calculateBollingerDerived` (pctB) | cross UP through `PCTB_OVERSOLD` (0.05) | cross DOWN through `PCTB_OVERBOUGHT` (0.95) |

---

## Task 1 — generic trigger helpers (pure domain, TDD)

**File:** `src/domain/validation/triggerScan.ts` (extend) + tests.

- [ ] `export function findThresholdCrossIndices(values: readonly (number | null)[], threshold: number, direction: ForwardDirection): number[]` — indices `i` where `values[i-1] <= threshold < values[i]` (up) or `values[i-1] >= threshold > values[i]` (down); skip null neighbours. Causal.
- [ ] `export function findFlipIndices<T>(states: readonly (T | null)[], to: T): number[]` — indices `i` where `states[i] === to` and `states[i-1]` is a non-null value `!== to` (a genuine flip INTO `to`, not the first appearance after null). Causal.
- [ ] Tests (worst cases): empty, all-null, no cross, multiple crosses, null neighbours skipped, flip-from-null excluded, flip detected; `toEqual` on exact index arrays.

## Task 2 — signal-definition constants

**File:** `src/domain/indicators/constants.ts` (add named consts).
- [ ] `MACDV_OVERSOLD = -150`, `MACDV_OVERBOUGHT = 150`, `CRSI_OVERSOLD = 10`, `CRSI_OVERBOUGHT = 90`, `PCTB_OVERSOLD = 0.05`, `PCTB_OVERBOUGHT = 0.95`, `FORCE_INDEX_ZERO = 0`, `ELDER_POWER_ZERO = 0`. (No magic literals in the runner.)

## Task 3 — validation runner

**File:** `scripts/validation/validateIndicators.ts` (new; imports `fetchBarsCached` from `./fetchData`, indicator calcs + trigger helpers from `@/...`).
- [ ] For each ticker (10) × timeframe (`1Day`,`1Hour`,`15Min`) with the 2-year cached bars (skip on insufficient bars / fetch failure, logged):
  - For each of the 7 directional indicators: compute its series; derive `bullish`/`bearish` trigger indices per the table; run `computeForwardEdge(closes, triggers, horizon, dir)` for each horizon (`1Day [5,10,20]`, `1Hour [6,12,24]`, `15Min [8,16,32]`).
- [ ] Aggregate per (indicator, direction, tf, horizon): pool triggers across tickers, report `triggerCount(n)`, `excessHitRate`, `excessMeanReturn`, `tStat`. Sequential FMP fetch (rate-limit friendly; reuse Phase 0 cache).
- [ ] Write `scripts/validation/reports/indicator-edge.md` (markdown table) + a short summary flagging, per indicator, whether any (tf,horizon) shows `excess>0 & |t|≥2 & n≥30` (→ provisional "signal") else "advisory".
- [ ] Note the 5 non-directional indicators (Hurst/VR/R² = regime filters; Yang-Zhang/EWMA = measurements) in the report with their intended role.

## Task 4 — run + report (controller, not implementer)
- [ ] Run `FMP_API_KEY=… npx tsx scripts/validation/validateIndicators.ts` (reuses `.cache`; `--refresh` for the new 2yr window first run). Bring `reports/indicator-edge.md` to the user for the signal/advisory/drop decision.

## Verify (implementer; NO commit)
`yarn lint`, `yarn typecheck` (root CJS + scripts ESM), `yarn test` (full) — all pass; new domain helpers ≥90% branch. Do NOT run the real FMP fetch (Task 4 is the controller's job). Leave changes in the working tree.

## Notes
- Functional style, `@internal`, named constants, length-cache, computed-value tests, `@/` cross-folder / relative same-folder — same conventions the cloud review enforces (PR #146–148).
- The report is the Phase 2 deliverable; the *decision* (which indicators are signal vs advisory vs drop) is the user's, and it scopes Phase 3.
