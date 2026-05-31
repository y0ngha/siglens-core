// Confirmed signal thresholds
/** @internal Lookback window (bars) for cross-based confirmed signals. */
export const CROSS_LOOKBACK_BARS = 3;

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
/** @internal EMA period used for trend slope evaluation. */
export const TREND_EMA_PERIOD = 20;

// Golden/Death cross periods: slow period (50) is not in MA_DEFAULT_PERIODS
/** @internal Fast MA period for golden/death cross detection. */
export const GOLDEN_CROSS_FAST_PERIOD = 20;
/** @internal Slow MA period for golden/death cross detection. */
export const GOLDEN_CROSS_SLOW_PERIOD = 50;
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
/** @internal MFI level whose upward cross marks an oversold bounce. */
export const MFI_OVERSOLD_LEVEL = 20; // MFI 20 상향 돌파 (과매도 반등)
/** @internal Squeeze-momentum zero line whose upward cross marks a bullish flip. */
export const SQUEEZE_MOMENTUM_ZERO_CROSS = 0; // 히스토그램 0 상향 돌파

// ─── Bearish detector thresholds (mirror of the bullish set) ─────────────────
// keltner / ichimoku / supertrend / parabolic-sar bearish detectors need no
// threshold constant — they are judged by channel breach or trend flip.
// DMI bearish reuses DMI_ADX_TREND_THRESHOLD; squeeze bearish reuses
// SQUEEZE_MOMENTUM_ZERO_CROSS (only the cross direction differs).

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
/** @internal MFI level whose downward cross marks an overbought reversal. */
export const MFI_OVERBOUGHT_LEVEL = 80; // MFI 80 하향 돌파 (과매수 반전)
