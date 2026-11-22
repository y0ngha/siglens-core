import {
    barCloseOf,
    diff,
    fmt,
    lastIndicator,
    lastNonNull,
    price,
} from '@/domain/analysis/indicatorReadingFigures';
import {
    readBollingerPctB,
    readBuySellRatio,
    readConnorsRsiLevel,
    readDonchianProximity,
    readKeltnerBand,
    readMacdVLevel,
    readStochasticLevel,
    readStochRsiLevel,
    readVwapDistance,
    readWilliamsRLevel,
} from '@/domain/analysis/skillGatingPredicates';
import type {
    IndicatorReadInput,
    ReadingOf,
    Skill,
    SkillStatePredicate,
} from '@/domain/types';

const statePredicateOf = (
    skill: Skill,
    fallback: SkillStatePredicate
): SkillStatePredicate => {
    const gating = skill.gating;
    return gating?.tier === 'gated' &&
        gating.signalKind === 'state' &&
        gating.state.feature === fallback.feature
        ? gating.state
        : fallback;
};

// ─── State kinds ──────────────────────────────────────────────────────────────
// The state comes from the gate's own reader; the values are what the prompt printed.

export function readStochastic(
    input: IndicatorReadInput
): ReadingOf<'stochastic'> | null {
    const found = readStochasticLevel(input.selection);
    if (found === null) return null;
    const last = lastIndicator(input.selection.indicators.stochastic);
    return {
        kind: 'stochastic',
        basis: 'state',
        state: found.state,
        values: {
            percentK: fmt(last?.percentK),
            percentD: fmt(last?.percentD),
        },
        signals: [],
    };
}

export function readStochRsi(
    input: IndicatorReadInput
): ReadingOf<'stoch_rsi'> | null {
    const found = readStochRsiLevel(input.selection);
    if (found === null) return null;
    const last = lastIndicator(input.selection.indicators.stochRsi);
    return {
        kind: 'stoch_rsi',
        basis: 'state',
        state: found.state,
        values: { k: fmt(last?.k), d: fmt(last?.d) },
        signals: [],
    };
}

export function readWilliamsR(
    input: IndicatorReadInput
): ReadingOf<'williams_r'> | null {
    const found = readWilliamsRLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'williams_r',
        basis: 'state',
        state: found.state,
        values: {
            williamsR: fmt(lastNonNull(input.selection.indicators.williamsR)),
        },
        signals: [],
    };
}

export function readConnorsRsi(
    input: IndicatorReadInput
): ReadingOf<'connors_rsi'> | null {
    const found = readConnorsRsiLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'connors_rsi',
        basis: 'state',
        state: found.state,
        values: {
            crsi: fmt(lastNonNull(input.selection.indicators.connorsRsi)),
        },
        signals: [],
    };
}

export function readBollinger(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'bollinger'> | null {
    const found = readBollingerPctB(
        statePredicateOf(skill, { feature: 'bollinger', predicate: 'pctB' }),
        input.selection
    );
    if (found === null) return null;
    const { indicators } = input.selection;
    const band = lastIndicator(indicators.bollinger);
    return {
        kind: 'bollinger',
        basis: 'state',
        state: found.state,
        values: {
            close: barCloseOf(input),
            upper: price(band?.upper, input.print),
            lower: price(band?.lower, input.print),
            pctB: fmt(lastIndicator(indicators.bollingerDerived)?.pctB),
        },
        signals: [],
    };
}

export function readKeltner(
    input: IndicatorReadInput
): ReadingOf<'keltner'> | null {
    const found = readKeltnerBand(input.selection);
    if (found === null) return null;
    const { indicators } = input.selection;
    const band = lastIndicator(indicators.keltnerChannel);
    return {
        kind: 'keltner',
        basis: 'state',
        state: found.state,
        values: {
            close: barCloseOf(input),
            upper: price(band?.upper, input.print),
            lower: price(band?.lower, input.print),
            atr: diff(lastNonNull(indicators.atr), input.print),
        },
        signals: [],
    };
}

export function readDonchian(
    input: IndicatorReadInput
): ReadingOf<'donchian'> | null {
    const found = readDonchianProximity(input.selection);
    if (found === null) return null;
    const band = lastIndicator(input.selection.indicators.donchianChannel);
    return {
        kind: 'donchian',
        basis: 'state',
        state: found.state,
        values: {
            close: barCloseOf(input),
            upper: price(band?.upper, input.print),
            lower: price(band?.lower, input.print),
        },
        signals: [],
    };
}

export function readVwap(input: IndicatorReadInput): ReadingOf<'vwap'> | null {
    const found = readVwapDistance(input.selection);
    if (found === null) return null;
    const { indicators } = input.selection;
    return {
        kind: 'vwap',
        basis: 'state',
        state: found.state,
        values: {
            close: barCloseOf(input),
            vwap: price(lastNonNull(indicators.vwap), input.print),
            atr: diff(lastNonNull(indicators.atr), input.print),
        },
        signals: [],
    };
}

export function readBuySellVolume(
    input: IndicatorReadInput
): ReadingOf<'buy_sell_volume'> | null {
    const found = readBuySellRatio(input.selection);
    if (found === null) return null;
    return {
        kind: 'buy_sell_volume',
        basis: 'state',
        state: found.state,
        values: { buyRatio: fmt(found.raw.buyRatio) },
        signals: [],
    };
}

export function readMacdV(
    input: IndicatorReadInput
): ReadingOf<'macd_v'> | null {
    const found = readMacdVLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'macd_v',
        basis: 'state',
        state: found.state,
        values: { macdV: fmt(lastNonNull(input.selection.indicators.macdV)) },
        signals: [],
    };
}
