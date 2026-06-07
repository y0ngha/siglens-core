import type { IndicatorResult, SMCResult } from '@/domain/types';

export const EMPTY_SMC_RESULT: SMCResult = {
    swingHighs: [],
    swingLows: [],
    orderBlocks: [],
    fairValueGaps: [],
    equalHighs: [],
    equalLows: [],
    premiumZone: null,
    discountZone: null,
    equilibriumZone: null,
    structureBreaks: [],
};

export const EMPTY_INDICATOR_RESULT: IndicatorResult = {
    macd: [],
    bollinger: [],
    dmi: [],
    stochastic: [],
    stochRsi: [],
    rsi: [],
    cci: [],
    vwap: [],
    ma: {},
    ema: {},
    volumeProfile: null,
    ichimoku: [],
    atr: [],
    obv: [],
    parabolicSar: [],
    williamsR: [],
    supertrend: [],
    mfi: [],
    keltnerChannel: [],
    cmf: [],
    donchianChannel: [],
    buySellVolume: [],
    smc: EMPTY_SMC_RESULT,
    squeezeMomentum: [],
    macdV: [],
    connorsRsi: [],
    forceIndex: [],
    elderRay: [],
    elderImpulse: [],
    bollingerDerived: [],
    chandelierExit: [],
    yangZhang: [],
    ewmaVolatility: [],
    hurst: [],
    varianceRatio: [],
    regression: [],
};

export const RSI_DEFAULT_PERIOD = 14;
export const RSI_OVERBOUGHT_LEVEL = 70;
export const RSI_OVERSOLD_LEVEL = 30;

export const MACD_FAST_PERIOD = 12;
export const MACD_SLOW_PERIOD = 26;
export const MACD_SIGNAL_PERIOD = 9;

/** @internal Default Bollinger Bands lookback period. */
export const BOLLINGER_DEFAULT_PERIOD = 20;
/** @internal Default Bollinger Bands standard-deviation multiplier. */
export const BOLLINGER_DEFAULT_STD_DEV = 2;

export const DMI_DEFAULT_PERIOD = 14;

export const STOCHASTIC_K_PERIOD = 14;
export const STOCHASTIC_D_PERIOD = 3;
export const STOCHASTIC_SMOOTHING = 3;
export const STOCHASTIC_OVERBOUGHT_LEVEL = 80;
export const STOCHASTIC_OVERSOLD_LEVEL = 20;

export const STOCH_RSI_RSI_PERIOD = 14;
export const STOCH_RSI_STOCH_PERIOD = 14;
export const STOCH_RSI_K_PERIOD = 3;
export const STOCH_RSI_D_PERIOD = 3;
export const STOCH_RSI_OVERBOUGHT_LEVEL = 0.8;
export const STOCH_RSI_OVERSOLD_LEVEL = 0.2;

export const CCI_DEFAULT_PERIOD = 20;
/** @internal CCI mean-deviation normalization constant. */
export const CCI_NORMALIZATION_CONSTANT = 0.015;
export const CCI_OVERBOUGHT_LEVEL = 100;
export const CCI_OVERSOLD_LEVEL = -100;
export const CCI_ZERO_LEVEL = 0;

export const MA_DEFAULT_PERIODS = [5, 20, 60, 120, 200] as const;
export const EMA_DEFAULT_PERIODS = [9, 20, 21, 60] as const;

/** @internal Index into EMA_DEFAULT_PERIODS for the short support/resistance EMA. */
export const EMA_SUPPORT_RESISTANCE_SHORT_INDEX = 1; // 20-period EMA
/** @internal Index into EMA_DEFAULT_PERIODS for the long support/resistance EMA. */
export const EMA_SUPPORT_RESISTANCE_LONG_INDEX = 3; // 60-period EMA

/** @internal Default ATR lookback period. */
export const ATR_DEFAULT_PERIOD = 14;

/** @internal Default Williams %R lookback period. */
export const WILLIAMS_R_DEFAULT_PERIOD = 14;

/** @internal Parabolic SAR initial acceleration factor. */
export const PSAR_AF_START = 0.02;
/** @internal Parabolic SAR acceleration-factor increment per new extreme. */
export const PSAR_AF_INCREMENT = 0.02;
/** @internal Parabolic SAR maximum acceleration factor. */
export const PSAR_AF_MAX = 0.2;

/** @internal Supertrend ATR lookback period. */
export const SUPERTREND_ATR_PERIOD = 10;
/** @internal Supertrend ATR band multiplier. */
export const SUPERTREND_MULTIPLIER = 3.0;

/** @internal Default Money Flow Index lookback period. */
export const MFI_DEFAULT_PERIOD = 14;

/** @internal Keltner Channel EMA midline period. */
export const KELTNER_EMA_PERIOD = 20;
/** @internal Keltner Channel ATR band period. */
export const KELTNER_ATR_PERIOD = 10;
/** @internal Keltner Channel ATR band multiplier. */
export const KELTNER_MULTIPLIER = 2.0;

/** @internal Default Chaikin Money Flow lookback period. */
export const CMF_DEFAULT_PERIOD = 21;

/** @internal Default Donchian Channel lookback period. */
export const DONCHIAN_DEFAULT_PERIOD = 20;

/** @internal Ichimoku conversion-line (tenkan) period. */
export const ICHIMOKU_CONVERSION_PERIOD = 9;
/** @internal Ichimoku base-line (kijun) period. */
export const ICHIMOKU_BASE_PERIOD = 26;
/** @internal Ichimoku leading span B period. */
export const ICHIMOKU_SPAN_B_PERIOD = 52;
/** @internal Ichimoku cloud forward/back displacement in bars. */
export const ICHIMOKU_DISPLACEMENT = 26;

/** @internal Volume Profile default number of price rows. */
export const VP_DEFAULT_ROW_SIZE = 24;
/** @internal Volume Profile value-area volume fraction. */
export const VP_VALUE_AREA_PERCENTAGE = 0.7;
/** @internal Volume Profile minimum bars required to compute. */
export const VP_MIN_BARS = 30;

/** @internal Squeeze Momentum Bollinger Bands length. */
export const SQUEEZE_MOMENTUM_BB_LENGTH = 20;
/** @internal Squeeze Momentum Keltner Channel length. */
export const SQUEEZE_MOMENTUM_KC_LENGTH = 20;
/** @internal Squeeze Momentum Keltner Channel multiplier. */
export const SQUEEZE_MOMENTUM_KC_MULT = 1.5;
/** @internal Squeeze Momentum minimum bars before the first valid result. */
// Actual warmup: delta window of kcLength requires kcLength delta values,
// each of which needs kcLength bars → first valid result at index 2*kcLength-2.
export const SQUEEZE_MOMENTUM_MIN_BARS = 2 * SQUEEZE_MOMENTUM_KC_LENGTH - 1;

/** @internal SMC swing-point detection lookback period. */
export const SMC_SWING_PERIOD = 5;
/** @internal SMC equal-high/low tolerance as an ATR multiple. */
export const SMC_EQUAL_LEVEL_ATR_MULTIPLIER = 0.5;
/** @internal Minimum swing touches needed to emit an equal-level cluster. */
export const SMC_EQUAL_LEVEL_MIN_TOUCHES = 2;
/**
 * @internal Hard cap on emitted equal-high/low clusters (most recent kept).
 * Bounds the equal-level output size even on degenerate flat-price series;
 * consumers read only the last few levels, so trimming the tail loses nothing.
 */
export const SMC_MAX_EQUAL_LEVELS_RETAINED = 50;
/** @internal SMC ATR period used for level/zone sizing. */
export const SMC_ATR_PERIOD = 14;
/** @internal SMC premium-zone threshold ratio of the dealing range. */
export const SMC_PREMIUM_RATIO = 0.75;
/** @internal SMC discount-zone threshold ratio of the dealing range. */
export const SMC_DISCOUNT_RATIO = 0.25;

export const HIGH_CONFIDENCE_WEIGHT = 0.8;
/** @internal Confidence weight applied when no skill matches a signal. */
export const UNMATCHED_SKILL_CONFIDENCE_WEIGHT = 0;

// ─── Pro Indicators Phase 1 ──────────────────────────────────────────────────

/** @internal MACD-V ATR normalization period (same as MACD slow period). */
export const MACD_V_ATR_PERIOD = 26;
/** @internal MACD-V scale factor (express as percentage). */
export const MACD_V_SCALE = 100;

/** @internal Connors RSI — close RSI period. */
export const CRSI_RSI_PERIOD = 3;
/** @internal Connors RSI — streak RSI period. */
export const CRSI_STREAK_PERIOD = 2;
/** @internal Connors RSI — percent-rank lookback period. */
export const CRSI_PCTRANK_PERIOD = 100;
/** @internal Connors RSI — number of components averaged. */
export const CRSI_COMPONENT_COUNT = 3;

/** @internal Force Index EMA smoothing period. */
export const FORCE_INDEX_PERIOD = 13;

/** @internal Elder-Ray EMA period. */
export const ELDER_RAY_PERIOD = 13;

/** @internal Elder Impulse EMA period. */
export const ELDER_IMPULSE_EMA_PERIOD = 13;

/** @internal Chandelier Exit ATR lookback period. */
export const CHANDELIER_PERIOD = 22;
/** @internal Chandelier Exit ATR band multiplier. */
export const CHANDELIER_ATR_MULT = 3;

/** @internal EWMA volatility decay factor (RiskMetrics standard). */
export const EWMA_LAMBDA = 0.94;

/** @internal Yang-Zhang volatility rolling window (bars; needs 1 prior close). */
export const YANG_ZHANG_PERIOD = 20;
/** @internal Yang-Zhang k-weight numerator (Yang & Zhang 2000). */
export const YANG_ZHANG_K_NUM = 0.34;
/** @internal Yang-Zhang k-weight denominator base (Yang & Zhang 2000). */
export const YANG_ZHANG_K_DEN_BASE = 1.34;

/** @internal Hurst exponent rolling window of log-returns. */
export const HURST_WINDOW = 100;
/** @internal Hurst R/S sub-window divisor — quarter of the window. */
export const HURST_SUBWINDOW_DIVISOR_QUARTER = 4;
/** @internal Hurst R/S sub-window divisor — half of the window. */
export const HURST_SUBWINDOW_DIVISOR_HALF = 2;
/** @internal Hurst R/S sub-window divisor — the full window. */
export const HURST_SUBWINDOW_DIVISOR_FULL = 1;
/** @internal Minimum distinct sub-window lengths required to fit the R/S slope. */
export const HURST_MIN_SUBWINDOWS = 2;
/** @internal Hurst exponent clamp lower bound. */
export const HURST_MIN = 0;
/** @internal Hurst exponent clamp upper bound. */
export const HURST_MAX = 1;
/**
 * @internal Hurst random-walk midpoint — H > 0.5 trending (persistent),
 * H < 0.5 mean-reverting (anti-persistent), H ≈ 0.5 random walk. Single
 * source of truth shared by the regime gate and the prompt regime classifier.
 */
export const HURST_RANDOM_WALK = 0.5;

/** @internal Variance Ratio aggregation horizon (q-period returns). */
export const VR_Q = 2;
/** @internal Variance Ratio rolling window of 1-period returns. */
export const VR_WINDOW = 60;
/**
 * @internal Variance-ratio random-walk center — VR > 1 trending, VR < 1
 * mean-reverting, VR ≈ 1 random walk. Shared by the regime gate and prompt.
 */
export const VR_RANDOM_WALK = 1;

/** @internal Linear-regression trailing window (bars). */
export const REGRESSION_PERIOD = 20;
/**
 * @internal Regression trend is "clean enough to flag" at r² ≥ this cutoff. A
 * fixed cutoff is a deliberate simplification of the window-scaled critical-R²
 * table (which tightens as the window shrinks); 0.3 is a conservative pick for
 * the default {@link REGRESSION_PERIOD} window (~20 bars, whose 95% critical-R²
 * ≈ 0.20). Shared by the skill-gating predicate and the prompt regime narrative.
 * See the research dossier (section 10) for the full table.
 */
export const REGRESSION_R2_SIGNIFICANT = 0.3;

/** @internal MACD-V oversold reset threshold (volatility-normalised MACD). */
export const MACDV_OVERSOLD = -150;
/** @internal MACD-V overbought reset threshold (volatility-normalised MACD). */
export const MACDV_OVERBOUGHT = 150;

/** @internal Connors RSI oversold threshold. */
export const CRSI_OVERSOLD = 10;
/** @internal Connors RSI overbought threshold. */
export const CRSI_OVERBOUGHT = 90;

/** @internal Bollinger %B oversold threshold (lower-band proximity). */
export const PCTB_OVERSOLD = 0.05;
/** @internal Bollinger %B overbought threshold (upper-band proximity). */
export const PCTB_OVERBOUGHT = 0.95;

/** @internal Force Index zero line (bull/bear pressure pivot). */
export const FORCE_INDEX_ZERO = 0;

/** @internal Elder-Ray bull/bear power zero line. */
export const ELDER_POWER_ZERO = 0;
