import {
    readAdx,
    readAtr,
    readEma,
    readMa,
    readObv,
    readVolumeProfile,
} from '@/domain/analysis/indicatorReadingsAlwaysOn';
import {
    readBollingerPercentB,
    readCci,
    readCmf,
    readDmi,
    readIchimoku,
    readMacd,
    readMfi,
    readParabolicSar,
    readRsi,
    readSqueezeMomentum,
    readSupertrend,
} from '@/domain/analysis/indicatorReadingsEvent';
import {
    readChandelier,
    readElderImpulse,
    readElderRay,
    readEwma,
    readForceIndex,
    readHurst,
    readRegression,
    readVarianceRatio,
    readYangZhang,
} from '@/domain/analysis/indicatorReadingsRegime';
import {
    readBollinger,
    readBuySellVolume,
    readConnorsRsi,
    readDonchian,
    readKeltner,
    readMacdV,
    readStochastic,
    readStochRsi,
    readVwap,
    readWilliamsR,
} from '@/domain/analysis/indicatorReadingsState';
import type {
    IndicatorCardKind,
    IndicatorReadInput,
    IndicatorReading,
    ReadingOf,
    Skill,
} from '@/domain/types';

const READERS: {
    readonly [K in IndicatorCardKind]: (
        input: IndicatorReadInput,
        skill: Skill
    ) => ReadingOf<K> | null;
} = {
    ma: readMa,
    ema: readEma,
    adx: readAdx,
    atr: readAtr,
    obv: readObv,
    volume_profile: readVolumeProfile,
    rsi: readRsi,
    macd: readMacd,
    cci: readCci,
    cmf: readCmf,
    dmi: readDmi,
    ichimoku: readIchimoku,
    mfi: readMfi,
    parabolic_sar: readParabolicSar,
    squeeze_momentum: readSqueezeMomentum,
    supertrend: readSupertrend,
    bollinger_percent_b: readBollingerPercentB,
    stochastic: readStochastic,
    stoch_rsi: readStochRsi,
    williams_r: readWilliamsR,
    connors_rsi: readConnorsRsi,
    bollinger: readBollinger,
    keltner: readKeltner,
    donchian: readDonchian,
    vwap: readVwap,
    buy_sell_volume: readBuySellVolume,
    macd_v: readMacdV,
    force_index: readForceIndex,
    elder_ray: readElderRay,
    elder_impulse: readElderImpulse,
    chandelier: readChandelier,
    hurst: readHurst,
    variance_ratio: readVarianceRatio,
    regression: readRegression,
    yang_zhang: readYangZhang,
    ewma: readEwma,
};

/**
 * @internal The reading of `kind` for `skill` on this chart, or `null` when the kind has
 * nothing to say (see {@link READERS}). `skill` supplies an event guide's triggers and a state
 * guide's threshold overrides.
 */
export function readIndicator(
    kind: IndicatorCardKind,
    skill: Skill,
    input: IndicatorReadInput
): IndicatorReading | null {
    // Each reader returns its own kind's reading; the union is what a caller reads.
    const read: (
        input: IndicatorReadInput,
        skill: Skill
    ) => IndicatorReading | null = READERS[kind];
    return read(input, skill);
}
