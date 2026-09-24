# Crypto Market Fear & Greed Index — Design (siglens-core)

Date: 2026-09-25
Consumer: siglens `/[locale]/fear-greed/crypto` (separate spec in the siglens repo)

## Goal

A market-wide Fear & Greed score for the crypto market, on the same 0–100 scale,
5-stage labels, confidence vocabulary and walk-forward history as
`computeMarketFearGreedIndex` (US / KR), so the three indices can sit side by side.
The crypto index keeps the shared machinery (walk-forward percentile per factor,
equal-weight mean) and swaps in crypto-appropriate factors.

## Public API

```ts
export interface CryptoDailyBar {
    date: string;   // ISO YYYY-MM-DD (UTC day)
    close: number;
    volume: number; // quote volume in one common currency (USD). Only ratios are used.
}

export interface CryptoFearGreedInput {
    /** Benchmark coin (BTC). Drives momentum, downside volatility, safe-haven, alt-season, volume flow sign. */
    benchmark: CryptoDailyBar[];
    /** Safe-haven asset closes (gold). Trades 5 days/week — forward-filled onto the crypto calendar. */
    safeHaven: MarketDailyClose[];
    /** Other large coins, keyed by any id the consumer chooses. Core never sees tickers. */
    universe: Record<string, CryptoDailyBar[]>;
}

export type CryptoFearGreedFactorKey =
    | 'momentum'
    | 'downside_volatility'
    | 'safe_haven'
    | 'breadth'
    | 'alt_season'
    | 'volume_flow';

export const CRYPTO_FEAR_GREED_FACTOR_KEYS: readonly CryptoFearGreedFactorKey[]; // display order as above

export interface CryptoFearGreedFactor { key: CryptoFearGreedFactorKey; rawValue: number; percentile: number; }

export interface CryptoFearGreedSnapshot {
    score: number;             // equal-weight mean of 6 factor percentiles
    label: FearGreedLabel;
    factors: CryptoFearGreedFactor[];
    confidence: 'normal' | 'limited';
    sampleSize: number;
    asOf: string;
}

export function computeCryptoFearGreedIndex(input: CryptoFearGreedInput): CryptoFearGreedSnapshot | null;
export function computeCryptoFearGreedHistory(input: CryptoFearGreedInput): MarketFearGreedHistoryPoint[];
```

`null` cases mirror the market index: no common session, latest session inside warm-up,
sample below `FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED`, **or `universe` has fewer than
`CRYPTO_FEAR_GREED_MIN_UNIVERSE` (5) coins** (breadth / alt-season become meaningless).

## Calendar alignment

- Session dates = inner join of `benchmark` and every `universe` series (7-day crypto calendar).
- `safeHaven` is forward-filled onto those dates (last known close ≤ date). Sessions before the
  first safe-haven observation are dropped.
- Input need not be sorted or deduplicated (same contract as `alignSeries`).

## Factors (all oriented so larger = greedier)

| Key | Raw value at session t | Window |
|---|---|---|
| `momentum` | (BTC close − SMA125) / SMA125 | 125 |
| `downside_volatility` | −sqrt(mean(min(0, ln(Cᵢ/Cᵢ₋₁))²)) over BTC | 30 |
| `safe_haven` | BTC 20-session return − safe-haven 20-session return | 20 |
| `breadth` | share of coins in {benchmark} ∪ universe whose close > own SMA50 | 50 |
| `alt_season` | share of universe coins whose 90-session return > BTC 90-session return | 90 |
| `volume_flow` | Σ total quote volume on sessions where BTC closed ≥ previous close ÷ Σ total quote volume, over the window (total = benchmark + universe) | 30 |

Warm-up = `max(125 − 1, 90, 30)` = 124 sessions. A session where any factor is `null`
contributes no sample and scores `null` in the history.

Composite = equal-weight mean of the six walk-forward percentiles (`percentile()` mid-rank,
sample = valid factor bundles strictly before t). Confidence thresholds and `scoreToLabel`
are shared with the other indices.

### Why these factors (validated 2026-09-25)

Prototype on FMP daily bars (BTC + 19 alts + GCUSD, from 2021-01-01, 1,518 scored sessions),
compared daily with alternative.me Crypto Fear & Greed (reference only — it mixes social and
survey data we do not have):

| Factor | corr vs alternative.me |
|---|---|
| momentum | 0.64 |
| breadth | 0.60 |
| safe_haven | 0.45 |
| volume_flow (30d up-day share) | 0.45 |
| downside_volatility (30d) | 0.32 |
| alt_season (90d) | 0.25 |

Rejected during validation: plain realized volatility vs its 50-day MA (corr 0.02 — crypto
volatility spikes on rallies too), 7d/90d volume surge signed by 7d return (0.15), alt-season
over 30/60 days (0.11/0.21), ETH-vs-BTC as a junk-bond analogue (double-counts alt-season).

Composite: corr 0.63, same-or-adjacent label 82%, label distribution 17/21/18/31/13 %
(alternative.me 16/24/20/33/6). Event checks: FTX 2022-11-10 = 28, ATH 2024-03-13 = 85,
carry-trade crash 2024-08-05 = 12, post-election 2024-11-12 = 84, 2025-02-28 = 14,
tariff shock 2025-04-08 = 19.

## Code structure

New folder `src/domain/indicators/cryptoFearGreed/` (`types.ts`, `align.ts`, `factors.ts`,
`index.ts`), mirroring `marketFearGreed/`.

Shared-machinery refactor (no behaviour change for US/KR):
- Generalise `composeMarketSnapshot` to take an ordered key list and `Record<K, number>`
  bundles, returning `{ score, label, factors: { key, rawValue, percentile }[], confidence, sampleSize }`.
  `marketFearGreed/composition.ts` becomes a thin call with `MARKET_FEAR_GREED_FACTOR_KEYS`.
- Extract the walk-forward loop (snapshot + history over a factor time series) into a generic
  helper used by both indices.
- `returnOver` / `distanceFromMa` move to a shared module so both factor files use one copy.

## Tests

- Regression lock: existing `computeMarketFearGreedIndex` / `History` fixtures produce
  byte-identical output after the refactor.
- Per-factor unit tests with hand-computed fixtures (incl. downside volatility on an all-up
  series = 0, volume_flow = 1 when every session is up).
- Alignment: gold weekend forward-fill; leading sessions before first gold close dropped;
  a coin missing a day removes that day for all.
- `null` paths: universe < 5, warm-up, insufficient sample.
- Walk-forward invariant: appending sessions never changes earlier history points.

## Release

Minor bump (new public API). Export new functions, types and `CRYPTO_FEAR_GREED_FACTOR_KEYS`
from `src/index.ts`. Release via `v*` tag push (see memory: release method); verify the
tarball before bumping siglens.

## Out of scope

- Per-symbol `computeFearGreedIndex` stays unchanged (shared by stocks and crypto; market-level
  factors do not apply to a single asset). Revisit separately after measuring BTC per-symbol
  score against alternative.me.
- Weighting other than equal weight; dominance / funding / social data (not available from FMP).
