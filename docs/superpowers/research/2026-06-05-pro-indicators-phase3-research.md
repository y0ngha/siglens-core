# Pro-Indicators Phase 3 — Research Dossier (skill-doc + prompt-framing source)

> Citation-backed research for the 12 pro-indicators wired in Phase 3. Reliability tiers are reconciled with **our own** 2-year, look-ahead-safe forward-edge study (10 large-cap US equities, pooled — see `scripts/validation/reports/indicator-edge.md`). The throughline: standalone directional edges are ≈0 (working-as-designed for filter/permission/divergence tools); Bollinger %B is the only modest edge; the regime trio conditions everything else; the volatility pair is risk/measurement.

---

## Layer model (drives prompt placement + gating)

1. **Regime layer (conditioning)** — Hurst, Variance Ratio, Regression R². Answers "trending vs mean-reverting, how cleanly." Weights/gates the directional reads.
2. **Volatility/risk layer (measurement)** — Yang-Zhang, EWMA. Answers "how much is price moving." Sizes stops/risk, contextualizes follow-through. No direction.
3. **Directional confluence layer (advisory)** — MACD-V, Connors RSI, Force Index, Elder-Ray, Elder Impulse, Chandelier. Standalone edge ≈0; value is confluence/permission/divergence/stop.
4. **Mean-reversion event signal** — Bollinger %B (the one measured edge: daily short reversion). %B/BandWidth.

---

## 1. MACD-V (volatility-normalized momentum) — Alex Spiroglou
- **Origin:** Spiroglou, "MACD-V: Volatility Normalised Momentum." SSRN 4099617 (3 May 2022). **Twice-awarded: NAAIM Founders Award 2022 + CMT Charles H. Dow Award 2022.** Extends Appel's MACD + Aspray's histogram.
- **Formula:** `MACD-V = [(EMA(close,12) − EMA(close,26)) / ATR(26)] × 100`; Signal = EMA(MACD-V,9). Standard 12/26/9, ATR 26.
- **Meaning:** momentum *in excess of average volatility*, %-expressed → cross-time AND cross-market comparable (PPO only fixes cross-time). ±150 ≈ 95%-containment OB/OS band (held on S&P, Bund, NatGas); ±50 = weak/strong transition; 0 = momentum regime flip. 8-state "momentum lifecycle" (Ranging/Rallying/Rebounding/Retracing/Reversing/Risk). Under a 200-EMA trend filter, OB/OS become asymmetric (bull regime: pullbacks bottom ≈ −100, the "new oversold").
- **Signals:** cross up through −150 (oversold reset), cross down through +150 (overbought rollover), signal-line cross, 0-line regime flip.
- **Our data:** 0/18 cells significant (best 1H h=12 t≈1.94, NS). The source paper is **descriptive/taxonomy, no forward-profitability test** → our null does NOT contradict it.
- **Reliability:** standalone **LOW**; confluence/regime-context **MEDIUM**. Use under a trend filter; never a standalone intraday trigger.
- **Sources:** naaim.org/.../MACD-V-Alex-Spiroglou-WEB.pdf · ssrn.com/abstract=4099617 · chartschool.stockcharts.com (MACD-V).

## 2. Connors RSI (CRSI) — Larry Connors (Connors Research, 2012)
- **Origin:** Connors, Alvarez, Radtke, "An Introduction to ConnorsRSI," Connors Research 2012 (ISBN 978-0-9853072-9-5).
- **Formula:** `CRSI(3,2,100) = [RSI(close,3) + RSI(streak,2) + PercentRank(ROC1,100)] / 3`. Components: price momentum, streak duration, return magnitude rank. Averaged (majority-rules robustness).
- **Thresholds:** <10 oversold / >90 overbought (extreme because CRSI moves fast). Exit longs when CRSI 50–80.
- **Signals:** CRSI<10 → short-term mean-reversion long; >90 → mean-reversion short. **Short-hold (2–5, up to ~8 days), counter-trend.**
- **Our data:** 0 cells significant; several **negative** t-stats. Connors' own backtests are in-sample/hypothetical/parameter-grid-selected/stop-less on a broad 2001–2012 universe; Connors himself: "many of the edges I saw in the 1990s are no longer there." His edge was the FULL multi-filter system (ADX>30 + measured sell-off + bottom-of-range + limit entry + CRSI exit), not the lone trigger.
- **Reliability:** standalone **LOW**; confluence (pullback-quality + exit gauge, non-trending liquid names) **MEDIUM**.
- **Sources:** qmatix.com/ConnorsRSI-Pullbacks-Guidebook.pdf · tradingview CRSI · chartschool ConnorsRSI · alvarezquanttrading.com · quantifiedstrategies.com.

## 3. Force Index — Alexander Elder (Trading for a Living, 1993)
- **Formula:** `FI(1) = (Close − PrevClose) × Volume`; default `FI(13) = EMA13 of FI(1)`. FI(2)=fast timer, FI(13)=trend/divergence, FI(~100)=bias filter.
- **Concept:** fuses direction + extent + volume — the "force" behind a move.
- **Signals:** 0-line cross; **divergences (primary)**; FI(2) dip in an uptrend = buy-the-dip timer (with a 22-EMA trend filter).
- **Our data:** 0/18 cells, |t|<1.8. Literature explicitly: "shouldn't be used on its own"; divergence "not a trade signal in itself."
- **Reliability:** standalone **LOW**; confluence **MODERATE** (volume confirmation + divergence warning).
- **Sources:** chartschool (Force Index) · daytrading.com/force-index · luxalgo.

## 4. Elder-Ray (Bull Power / Bear Power) — Elder (dev. 1989, pub. 1993)
- **Formula:** `Bull Power = High − EMA13`, `Bear Power = Low − EMA13`. EMA13 = consensus of value; high=max buyer power, low=max seller power. Normally Bull>0, Bear<0.
- **Signals (Elder's 4 long conditions):** uptrend (EMA13 rising) + **Bear Power negative but rising** (core) + higher Bull-Power top + bullish divergence. Mirror for shorts. Best buy = Bear Power negative & turning up; **divergences are the highest-quality variant.**
- **Our data:** 0/18 cells, |t|<1.8. Naive 0-cross was never the recommended signal (false signals in ranges; use inside Triple Screen).
- **Reliability:** standalone **LOW**; confluence **MODERATE–HIGH for divergence within a trend.**
- **Sources:** tradingpedia (Elder-Ray) · admiralmarkets · trendspider · daytrading.com.

## 5. Elder Impulse System — Elder (Come Into My Trading Room, 2002)
- **Formula (bar coloring):** GREEN if EMA13 rising AND MACD-hist rising; RED if both falling; BLUE otherwise. MACD(12,26,9).
- **Concept — CENSORSHIP/PERMISSION (Elder's words):** "It doesn't tell me what to do but rather what I'm not allowed to do." GREEN → longs allowed, **shorting forbidden**; RED → shorts allowed, **buying prohibited**; BLUE → both allowed. "Enter cautiously, exit fast." The flip *off* a color is the permission event.
- **Signals:** permission flips green↔blue↔red change *what's forbidden*, not *what to do*.
- **Our data:** 0/18 cells, |t|<1.8. **Strongest "working-as-designed" result** — a censorship rule is not supposed to have a standalone forward edge; it should be evaluated by *conditional lift* on a separate entry method, not its own t-stat.
- **Reliability:** standalone **LOW/N-A**; as a **direction gate MODERATE–HIGH** (suppress counter-trend entries).
- **Sources:** chartschool (Elder Impulse) · O'Reilly (Fly Fishing the Stock Market, censorship quotes).

## 6. Bollinger %B + BandWidth — John Bollinger (Bollinger on Bollinger Bands, 2001)
- **%B formula:** `%B = (Close − Lower)/(Upper − Lower)`, std 20/2. 0=lower, 1=upper, >1 above, <0 below.
- **BandWidth:** `((Upper − Lower)/Middle) × 100` — volatility gauge, "the Squeeze" (low → breakout loading), **no direction**.
- **Signals:** %B cross down through ~0.95 = overbought-reversal short; cross up through ~0.05 = oversold-bounce long; sustained >0.80/<0.20 = trend; W-bottom/M-top divergences. BandWidth squeeze = breakout setup (direction unknown).
- **Author caveat (Rule 6):** "Tags of the bands are just that, tags not signals." Never standalone.
- **Our data — the ONE measured edge:** **%B overbought-reversal SHORT on DAILY (cross down 0.95): +0.94% excess h=5 (t=2.19, n=113), +2.00% h=10 (t=3.10, n=112)** — coherent (two horizons, same signal, right sign). %B oversold-long 1H h=24 (t=2.11) is isolated/likely artifact. Across 126 cells only 3 cleared vs ~6 expected by chance → even %B is **MODEST**, matches "contrarian Bollinger works, naive breakout doesn't" literature (Balsara/Fang; decay over time).
- **Reliability:** %B standalone **LOW–MODEST**; as confluence (daily, short, with confirmation) **MODEST — our designated event signal**. BandWidth = volatility gate, no direction. Combine with an *uncorrelated* confirmer (MFI/volume/candle), not a 2nd momentum osc.
- **Sources:** bollingerbands.com/bollinger-band-rules · chartschool (%B, BandWidth) · AUT "Popularity vs Profitability" PDF · SSRN 5775962.

## 7. Chandelier Exit — Charles Le Beau (1992), popularized by Elder
- **Formula:** long stop `= HighestHigh(22) − ATR(22)×3`; short stop `= LowestLow(22) + ATR(22)×3`. Ratchets, never loosens.
- **Concept:** volatility-adjusted **trailing stop / trend-regime flag** — explicitly an exit/risk tool, NOT an entry. StockCharts: "good for stops … use basic chart analysis or a momentum oscillator to time entries."
- **Signals:** trend flip long↔short (regime flag, advisory); trailing-stop level.
- **Our data:** 0 cells — exactly as theory predicts for a lagging ATR-stop construct. **Validates** advisory-only use.
- **Reliability:** standalone/entry **NONE — do not use for entries**; as trailing-stop/trend-regime context **GOOD for its job**.
- **Sources:** chartschool (Chandelier Exit) · LeBeau & Lucas (1992).

## 8. Hurst exponent (R/S) — Hurst (1951), fBm Mandelbrot & Van Ness (1968)
- **Formula:** R/S over window n → `E[R/S]ₙ = c·nᴴ`; H = slope of log(R/S) vs log(n). H∈[0,1]: >0.5 persistent/trending, <0.5 mean-reverting, ≈0.5 random walk.
- **Role:** regime classifier (conditioner). H>0.5 → up-weight trend-following; H<0.5 → up-weight mean-reversion; H≈0.5 → low confidence.
- **Caveats (be honest):** classical R/S has **small-sample positive bias** (Anis–Lloyd 1976 correction; Weron CIs), **window sensitivity**, and Lo (1991) modified R/S shows classical R/S confounds long-memory with short-range autocorrelation — apparent equity long-memory largely vanishes corrected. In liquid markets H sits near 0.5 and drifts. DFA/MFDFA often preferred.
- **Reliability:** standalone **MEDIUM-LOW**; confluence (corrected + confirmed) **MEDIUM**.
- **Sources:** Hurst 1951 Trans. ASCE 116:770–808 · Mandelbrot & Van Ness 1968 SIAM Rev 10:422–437 · Lo 1991 Econometrica 59:1279–1313 · Hamed 2007 WRR.

## 9. Variance Ratio — Lo & MacKinlay (1988, Rev. Financial Studies 1(1):41–66)
- **Formula:** `VR(q) = Var(q-period ret) / [q · Var(1-period ret)]`. ≈1 random walk, >1 trending/positive autocorr, <1 mean-reverting. Homoskedastic Z(q)=(VR−1)/√φ(q), φ(q)=2(2q−1)(q−1)/(3qT); heteroskedasticity-robust Z*(q) (essential under GARCH; 1990 erratum noted). Overlapping returns + bias-corrected denominator.
- **Role:** **most statistically grounded regime classifier** (ships with a significance test). VR>1 & Z* sig → trend regime; VR<1 & Z* sig → mean-reversion; ≈1 → random.
- **Caveats:** q-dependence (scan a grid), overlapping-sample bias, use robust Z*. Rejection ≠ direction. Best-replicated of the three.
- **Reliability:** **MEDIUM-HIGH among regime tools** (with robust statistic + q acknowledged).
- **Sources:** Lo & MacKinlay 1988 (MIT/NBER w2168) · Mingze Gao derivation · EViews VR test.

## 10. Rolling Linear-Regression R² (trendiness)
- **Formula:** regress price on time over window; `R² = 1 − SS_res/SS_tot ∈ [0,1]` (squared price–time correlation). ≈0 choppy, ≈1 clean trend. **Direction-blind** — pair with slope sign.
- **Role:** trend-cleanliness conditioner. High R² → up-weight trend-following, don't fade; low R² → up-weight mean-reversion.
- **Critical detail:** R² rises mechanically as window shrinks → **significance threshold must scale with lookback** (95% critical-R²: n=5→0.77, n=14→0.27, n=20→0.20, n=30→0.13, n=60→0.06, n=120→0.03). Fixed cutoff = bug. Assumes linear trend (parabolic moves score lower); sensitive to price transform.
- **Reliability:** standalone **MEDIUM**; confluence trend-confirmation **MEDIUM-HIGH** (cheap, explicit thresholds, but direction-blind).
- **Sources:** chartschool (LR-R2) · tradingpedia (R-Squared method, critical table) · trendspider.

## 11. Yang-Zhang volatility — Yang & Zhang (2000, J. Business 73(3):477–492)
- **Formula:** `σ²_YZ = σ²_overnight + k·σ²_open-to-close + (1−k)·σ²_RS`, with `k = 0.34/(1.34 + (n+1)/(n−1))`. Overnight = ln(O/prevC); open-close = ln(C/O); RS = Rogers-Satchell drift-independent intraday. Minimum-variance combination; **drift-independent, jump-consistent.**
- **Role:** MEASUREMENT — vol regime, stop distance, position sizing, expansion/contraction, contextualizing signals. No direction.
- **Efficiency (honest):** abstract says "dramatic," gives **no fixed multiplier**; "up to ~14×" is a theoretical ceiling, **~7–8× typical** (MIT OCW). Discreteness/bad-tick bias; historical (lags regime breaks, less than CC).
- **Reliability:** directional weight **0**; best where you need a fast low-noise vol read from few bars.
- **Sources:** Yang & Zhang 2000 JSTOR 10.1086/209650 · portfoliooptimizer.io range-estimators · MIT OCW 18-642.

## 12. EWMA volatility (RiskMetrics, λ=0.94)
- **Formula:** `σ²_{t+1|t} = λ·σ²_{t|t−1} + (1−λ)·r²_t`; expanded `σ² = (1−λ)·Σ λ^{t−1} r²_t`. λ=0.94 daily (half-life ~11 days), 0.97 monthly. **No look-ahead.**
- **Why over SMA:** reacts faster to shocks, decays smoothly, no SMA "ghosting"/window-drop artifact.
- **λ=0.94 provenance (honest):** RiskMetrics 1996 — optimal λ per series by RMSE minimization across 480 series, then accuracy-weighted-averaged → 0.94. **Empirical convention, not a constant.**
- **Limitations:** restricted **IGARCH with NO mean reversion** (flat-horizon forecasts, over-persists after shocks); single fixed memory; λ-sensitive; normality → tail underestimation.
- **Role:** MEASUREMENT — dynamic risk scale, VaR/sizing, vol regime; directional weight **0**. Complementary to Yang-Zhang (EWMA=reactive/return-based forecast; YZ=efficient realized/OHLC). Divergence between them is itself informative (intraday churn vs close drift).
- **Sources:** J.P. Morgan/Reuters RiskMetrics Technical Document 4th ed. (1996) Ch. 5 (MSCI archive) · arXiv:2105.14382 (optimal-λ revisited).

---

## Confluence weighting summary (for prompt + skill `confidence_weight`)

| Indicator | Layer | Standalone | Confluence role | Suggested confidence_weight |
|---|---|---|---|---|
| Bollinger %B | reversion event | LOW–MODEST | **daily short mean-reversion (our only edge), needs confirmation** | 0.55 |
| MACD-V | directional | LOW | normalized momentum-state under trend filter | 0.4 |
| Connors RSI | directional | LOW | short-hold pullback quality + exit gauge | 0.4 |
| Force Index | directional | LOW | volume confirmation + divergence | 0.4 |
| Elder-Ray | directional | LOW | divergence within a trend | 0.45 |
| Elder Impulse | directional | LOW/N-A | **direction-permission gate** (suppress counter-trend) | 0.45 |
| Chandelier | directional | NONE | trailing-stop + trend-regime context | 0.35 |
| Hurst | regime | n/a | conditioner (trend vs revert) | 0.4 |
| Variance Ratio | regime | n/a | conditioner (firmest pedigree) | 0.5 |
| Regression R² | regime | n/a | trend-cleanliness conditioner | 0.45 |
| Yang-Zhang | volatility | n/a | realized vol / sizing / stops | n/a (measurement) |
| EWMA | volatility | n/a | reactive vol / sizing / regime | n/a (measurement) |

**Universal framing rule for the LLM:** present these as **context/confluence/permission/risk**, weighted by the regime + our measured reliability — NOT as standalone buy/sell triggers. Bollinger %B (daily, short, confirmed) is the single exception with a modest measured edge.
