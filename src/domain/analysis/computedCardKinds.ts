import type {
    ComputedCardKind,
    CycleCardKind,
    IndicatorCardBasis,
    IndicatorCardKind,
    IndicatorCardStates,
    IndicatorCardValues,
} from '@/domain/types';

/**
 * Every kind of indicator card, in the order the catalog lists them: always-on guides, event
 * guides, then state guides. The unit test pins that the list names every
 * `IndicatorCardKind` member, once.
 */
const INDICATOR_CARD_KIND_LIST = [
    'ma',
    'ema',
    'adx',
    'atr',
    'obv',
    'volume_profile',
    'rsi',
    'macd',
    'cci',
    'cmf',
    'dmi',
    'ichimoku',
    'mfi',
    'parabolic_sar',
    'squeeze_momentum',
    'supertrend',
    'bollinger_percent_b',
    'stochastic',
    'stoch_rsi',
    'williams_r',
    'connors_rsi',
    'bollinger',
    'keltner',
    'donchian',
    'vwap',
    'buy_sell_volume',
    'macd_v',
    'force_index',
    'elder_ray',
    'elder_impulse',
    'chandelier',
    'hurst',
    'variance_ratio',
    'regression',
    'yang_zhang',
    'ewma',
] as const satisfies readonly IndicatorCardKind[];

const CYCLE_CARD_KIND_LIST = [
    'ma_cycle',
    'macd_cycle',
] as const satisfies readonly CycleCardKind[];

/**
 * Every value a skill's `computed_card` frontmatter may take: the indicator kinds followed by
 * the two cycle kinds, in a stable order. The siglens catalog validator checks its tags against
 * this list instead of a copy.
 */
export const COMPUTED_CARD_KINDS: readonly ComputedCardKind[] = [
    ...INDICATOR_CARD_KIND_LIST,
    ...CYCLE_CARD_KIND_LIST,
];

/** @internal The indicator-card kinds alone (the cards `buildIndicatorCards` builds). */
export const INDICATOR_CARD_KINDS: readonly IndicatorCardKind[] =
    INDICATOR_CARD_KIND_LIST;

/** @internal The cycle-card kinds alone. */
export const CYCLE_CARD_KINDS: readonly CycleCardKind[] = CYCLE_CARD_KIND_LIST;

/**
 * @internal How each indicator kind reaches its state (the catalog's gating tier, fixed by the
 * kind): read on every chart, fired by detected signals, or fired by a textbook extreme.
 */
export const INDICATOR_CARD_BASIS: Readonly<
    Record<IndicatorCardKind, IndicatorCardBasis>
> = {
    ma: 'always_on',
    ema: 'always_on',
    adx: 'always_on',
    atr: 'always_on',
    obv: 'always_on',
    volume_profile: 'always_on',
    rsi: 'event',
    macd: 'event',
    cci: 'event',
    cmf: 'event',
    dmi: 'event',
    ichimoku: 'event',
    mfi: 'event',
    parabolic_sar: 'event',
    squeeze_momentum: 'event',
    supertrend: 'event',
    bollinger_percent_b: 'event',
    stochastic: 'state',
    stoch_rsi: 'state',
    williams_r: 'state',
    connors_rsi: 'state',
    bollinger: 'state',
    keltner: 'state',
    donchian: 'state',
    vwap: 'state',
    buy_sell_volume: 'state',
    macd_v: 'state',
    force_index: 'state',
    elder_ray: 'state',
    elder_impulse: 'state',
    chandelier: 'state',
    hurst: 'state',
    variance_ratio: 'state',
    regression: 'state',
    yang_zhang: 'state',
    ewma: 'state',
};

/** @internal Whether `kind` is one of the two cycle kinds. */
export const isCycleCardKind = (
    kind: ComputedCardKind
): kind is CycleCardKind => CYCLE_CARD_KINDS.some(k => k === kind);

/** @internal The `computed_card` value `raw` spells, or `undefined` for anything else. */
export const parseComputedCardKind = (
    raw: unknown
): ComputedCardKind | undefined =>
    COMPUTED_CARD_KINDS.find(kind => kind === raw);

/**
 * @internal The value keys of each indicator kind's reading, in the order the reading lists
 * them. The runtime mirror of `IndicatorCardValues`: the compiler rejects a missing kind and a
 * key the type does not name, and `normalizeIndicatorReading` accepts no other.
 */
export const INDICATOR_CARD_VALUE_KEYS: {
    readonly [K in IndicatorCardKind]: readonly IndicatorCardValues[K][];
} = {
    ma: ['close', 'ma5', 'ma20', 'ma60', 'ma120', 'ma200'],
    ema: ['ema9', 'ema20', 'ema21', 'ema60'],
    adx: ['adx', 'diPlus', 'diMinus'],
    atr: ['atr', 'atrPercent'],
    obv: ['obv'],
    volume_profile: ['close', 'poc', 'vah', 'val', 'bars'],
    rsi: ['rsi'],
    macd: ['macd', 'signal', 'histogram'],
    cci: ['cci'],
    cmf: ['cmf'],
    dmi: ['diPlus', 'diMinus', 'adx'],
    ichimoku: ['tenkan', 'kijun', 'senkouA', 'senkouB'],
    mfi: ['mfi'],
    parabolic_sar: ['sar'],
    squeeze_momentum: ['momentum'],
    supertrend: ['supertrend'],
    bollinger_percent_b: ['pctB'],
    stochastic: ['percentK', 'percentD'],
    stoch_rsi: ['k', 'd'],
    williams_r: ['williamsR'],
    connors_rsi: ['crsi'],
    bollinger: ['close', 'upper', 'lower', 'pctB'],
    keltner: ['close', 'upper', 'lower', 'atr'],
    donchian: ['close', 'upper', 'lower'],
    vwap: ['close', 'vwap', 'atr'],
    buy_sell_volume: ['buyRatio'],
    macd_v: ['macdV'],
    force_index: ['forceIndex'],
    elder_ray: ['bullPower', 'bearPower'],
    elder_impulse: [],
    chandelier: ['stop'],
    hurst: ['hurst'],
    variance_ratio: ['varianceRatio'],
    regression: ['r2'],
    yang_zhang: ['sigma'],
    ewma: ['sigma'],
};

/**
 * @internal The states each state-like indicator kind takes; `null` for an event kind, whose
 * state is the type of a fired signal. The runtime mirror of `IndicatorCardStates`.
 */
export const INDICATOR_CARD_STATE_VALUES: {
    readonly [K in IndicatorCardKind]: readonly IndicatorCardStates[K][] | null;
} = {
    ma: ['bullish_stack', 'bearish_stack', 'mixed'],
    ema: ['bullish_stack', 'bearish_stack', 'mixed'],
    adx: ['trending', 'between', 'weak'],
    atr: ['rising', 'falling', 'flat'],
    obv: ['rising', 'falling', 'flat'],
    volume_profile: [
        'above_value_area',
        'inside_value_area',
        'below_value_area',
    ],
    rsi: null,
    macd: null,
    cci: null,
    cmf: null,
    dmi: null,
    ichimoku: null,
    mfi: null,
    parabolic_sar: null,
    squeeze_momentum: null,
    supertrend: null,
    bollinger_percent_b: null,
    stochastic: ['overbought', 'oversold'],
    stoch_rsi: ['overbought', 'oversold'],
    williams_r: ['overbought', 'oversold'],
    connors_rsi: ['overbought', 'oversold'],
    bollinger: ['above_band_pctb', 'below_band_pctb'],
    keltner: ['beyond_upper', 'beyond_lower', 'near_upper', 'near_lower'],
    donchian: ['beyond_upper', 'beyond_lower', 'near_upper', 'near_lower'],
    vwap: ['above', 'below'],
    buy_sell_volume: ['buy_dominant', 'sell_dominant'],
    macd_v: ['high_positive', 'high_negative'],
    force_index: ['turned_positive', 'turned_negative'],
    elder_ray: ['bear_power_rising', 'bull_power_falling', 'both'],
    elder_impulse: ['green', 'red', 'blue'],
    chandelier: ['flipped_long', 'flipped_short'],
    hurst: ['trending', 'mean_reverting'],
    variance_ratio: ['trending', 'mean_reverting'],
    regression: ['strong_fit_up', 'strong_fit_down'],
    yang_zhang: ['high_volatility', 'low_volatility'],
    ewma: ['high_volatility', 'low_volatility'],
};
