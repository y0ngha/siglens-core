// Confirmed signal thresholds
/** Lookback window (bars) for cross-based confirmed signals: a cross counts while it sits within the last this-many bars. */
export const CROSS_LOOKBACK_BARS = 3;

// Price-structure confirmed signals (52-week extremes, gaps)
/** @internal Calendar lookback (days) of the 52-week high/low window `[last − 365d, last)`. */
export const FIFTY_TWO_WEEK_LOOKBACK_DAYS = 365;
/**
 * @internal Minimum history (days) the 52-week window must reach back: its
 * first bar must sit at least this far before the last bar, otherwise the
 * "52-week" extreme is really a shorter one and the detector abstains. The
 * week of slack under {@link FIFTY_TWO_WEEK_LOOKBACK_DAYS} absorbs weekends
 * and holidays at the window's start.
 */
export const FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS = 358;
/** @internal Minimum gap size (last bar vs. previous bar range) as a multiple of ATR(14); ignored when ATR is unavailable. */
export const GAP_MIN_ATR_MULT = 0.25;

// Anticipation signal thresholds
/** @internal Lookback window (bars) for divergence pivot search. */
export const DIVERGENCE_LOOKBACK_BARS = 20;
/** @internal Max bars since the latest pivot for a divergence to count as fresh. */
export const DIVERGENCE_FRESHNESS_BARS = 5;
/** @internal Half-width (bars) of the pivot detection window. */
export const PIVOT_WINDOW = 2;

/** @internal Number of trailing bars inspected for MACD histogram convergence. */
export const HISTOGRAM_CONVERGENCE_BARS = 5;

/** @internal Lookback window (bars) for Bollinger squeeze width ranking. */
export const SQUEEZE_LOOKBACK_BARS = 120;
/** @internal Percentile threshold below which BB width counts as a squeeze. */
export const SQUEEZE_PERCENTILE = 0.1;
/** @internal %B threshold separating bullish vs bearish squeeze bias. */
export const SQUEEZE_PCT_B_THRESHOLD = 0.5;

/** @internal Max distance (fraction) from an MA to count as support/resistance proximity. */
export const SR_PROXIMITY_PCT = 0.02;
/** @internal Lookback window (bars) for support/resistance approach direction. */
export const SR_APPROACH_LOOKBACK = 5;

// Trend classification
/** @internal Lookback window (bars) for EMA slope used in trend classification. */
export const TREND_SLOPE_LOOKBACK = 20;
/** @internal EMA slope threshold separating trending vs sideways. */
export const TREND_SLOPE_THRESHOLD = 0.03;
/**
 * EMA period (bars) shared by the trend rules (`computeAnalysisTrend`: the top-level
 * `AnalysisResponse.trend`, also `technicalChangesBetween`'s `trend_changed`; and the
 * dashboard's `classifyTrend`) and by the other EMA20 readers (anticipation signals, the
 * confluence and higher-timeframe prompt sections): one constant, so copy never mirrors
 * the number. It counts bars of the analyzed timeframe, so it is 20 days only on daily
 * bars; for a stored analysis use its `trendBasis.emaPeriod`, not the live constant.
 * Server entrypoint only (API-1: the consumer is a server-side mail).
 */
export const TREND_EMA_PERIOD = 20;
/**
 * @internal Minimum EMA slope over `TREND_SLOPE_LOOKBACK` bars, in ATR(14) units, for the
 * analysis trend (`computeAnalysisTrend`) to leave `neutral`. The scale-free counterpart
 * of `TREND_SLOPE_THRESHOLD`; 1.0 was chosen because it reproduces the percent rule on
 * daily bars, not by agreement with any model label.
 */
export const TREND_SLOPE_MIN_ATR = 1.0;

// Golden/Death cross (50/200) and short-term MA cross (20/50) periods.
// Neither pair is fully in MA_DEFAULT_PERIODS ([5, 20, 60, 120, 200]); the detectors
// fall back to `calculateMA` for the missing periods.
/** Fast SMA period of the golden/death cross (the 50/200 "golden cross" in common usage). */
export const GOLDEN_CROSS_FAST_PERIOD = 50;
/** Slow SMA period of the golden/death cross. Detection needs `SLOW + 1` bars. */
export const GOLDEN_CROSS_SLOW_PERIOD = 200;
/** Fast SMA period of the short-term MA cross (the pre-C11e `golden_cross` rule). */
export const SHORT_MA_CROSS_FAST_PERIOD = 20;
/** Slow SMA period of the short-term MA cross. Detection needs `SLOW + 1` bars. */
export const SHORT_MA_CROSS_SLOW_PERIOD = 50;
/** @internal MA periods used as support/resistance reference levels. */
export const SR_MA_PERIODS = [50, 200] as const;

// ─── Bullish detector thresholds (buy-only backtest) ─────────────────────────

/** @internal Minimum ADX required for a DMI golden cross to qualify. */
export const DMI_ADX_TREND_THRESHOLD = 20; // DMI 골든크로스 성립을 위한 최소 ADX
/** @internal CCI level whose upward cross triggers an oversold-exit signal. */
export const CCI_OVERSOLD_CROSS_LEVEL = -100; // CCI -100 상향 돌파
/** @internal CCI level whose upward cross triggers a bullish-momentum signal. */
export const CCI_BULLISH_CROSS_LEVEL = 100; // CCI +100 상향 돌파
/** @internal CMF level whose upward cross marks an accumulation flip. */
export const CMF_BULLISH_CROSS_LEVEL = 0; // CMF 0 상향 (매집 전환)
/** @internal Squeeze-momentum zero line whose upward cross marks a bullish flip. */
export const SQUEEZE_MOMENTUM_ZERO_CROSS = 0; // 히스토그램 0 상향 돌파

// ─── Bearish detector thresholds (mostly mirror the bullish set, with one
// deliberate asymmetry) ──────────────────────────────────────────────────────
// keltner / ichimoku / supertrend / parabolic-sar bearish detectors need no
// threshold constant — they are judged by channel breach or trend flip.
// DMI bearish reuses DMI_ADX_TREND_THRESHOLD; squeeze bearish reuses
// SQUEEZE_MOMENTUM_ZERO_CROSS (only the cross direction differs).
//
// NOT a strict mirror: CCI_BEARISH_CROSS_LEVEL is intentionally 0, NOT the
// symmetric -100. The bearish-momentum trigger is a downward cross of the CCI
// zero line (matching CMF_BEARISH_CROSS_LEVEL = 0), not a plunge through the
// oversold floor. Do NOT "fix" it to -100 to make it look symmetric with
// CCI_BULLISH_CROSS_LEVEL (+100) — that would change the detector's meaning and
// regress the signal.

/**
 * @internal CCI level whose downward cross triggers an overbought-exit signal.
 * Shares the same numeric value (100) as {@link CCI_BULLISH_CROSS_LEVEL}; the
 * difference is the cross direction (down vs. up).
 */
export const CCI_OVERBOUGHT_CROSS_LEVEL = 100; // CCI +100 하향 돌파 (과매수 이탈)
/** @internal CCI level whose downward cross triggers a bearish-momentum signal. */
export const CCI_BEARISH_CROSS_LEVEL = 0; // CCI 0 하향 돌파
/**
 * @internal CMF level whose downward cross marks a distribution flip.
 * Shares the same numeric value (0) as {@link CMF_BULLISH_CROSS_LEVEL}; only the
 * cross DIRECTION (down vs. up) differs, decided by `findThresholdCross`'s
 * direction argument.
 */
export const CMF_BEARISH_CROSS_LEVEL = 0; // CMF 0 하향 (분산 전환)
