import {
    diff,
    fmt,
    lastIndicator,
    lastNonNull,
    PERCENT_FACTOR,
    price,
    volume,
} from '@/domain/analysis/indicatorReadingFigures';
import {
    readChandelierLevel,
    readElderImpulseLevel,
    readElderRayLevel,
    readEwmaLevel,
    readForceIndexLevel,
    readHurstLevel,
    readRegressionLevel,
    readVarianceRatioLevel,
    readYangZhangLevel,
} from '@/domain/analysis/skillGatingPredicates';
import type { IndicatorReadInput, ReadingOf } from '@/domain/types';

export function readForceIndex(
    input: IndicatorReadInput
): ReadingOf<'force_index'> | null {
    const found = readForceIndexLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'force_index',
        basis: 'state',
        state: found.state,
        values: {
            forceIndex: volume(
                lastNonNull(input.selection.indicators.forceIndex)
            ),
        },
        signals: [],
    };
}

export function readElderRay(
    input: IndicatorReadInput
): ReadingOf<'elder_ray'> | null {
    const found = readElderRayLevel(input.selection);
    if (found === null) return null;
    const last = lastIndicator(input.selection.indicators.elderRay);
    return {
        kind: 'elder_ray',
        basis: 'state',
        state: found.state,
        values: {
            bullPower: diff(last?.bullPower, input.print),
            bearPower: diff(last?.bearPower, input.print),
        },
        signals: [],
    };
}

export function readElderImpulse(
    input: IndicatorReadInput
): ReadingOf<'elder_impulse'> | null {
    const found = readElderImpulseLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'elder_impulse',
        basis: 'state',
        state: found.state,
        values: {},
        signals: [],
        flippedFrom: found.flippedFrom,
    };
}

export function readChandelier(
    input: IndicatorReadInput
): ReadingOf<'chandelier'> | null {
    const found = readChandelierLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'chandelier',
        basis: 'state',
        state: found.state,
        values: { stop: price(found.raw.stop, input.print) },
        signals: [],
    };
}

export function readHurst(
    input: IndicatorReadInput
): ReadingOf<'hurst'> | null {
    const found = readHurstLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'hurst',
        basis: 'state',
        state: found.state,
        values: { hurst: fmt(lastNonNull(input.selection.indicators.hurst)) },
        signals: [],
    };
}

export function readVarianceRatio(
    input: IndicatorReadInput
): ReadingOf<'variance_ratio'> | null {
    const found = readVarianceRatioLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'variance_ratio',
        basis: 'state',
        state: found.state,
        values: {
            varianceRatio: fmt(
                lastNonNull(input.selection.indicators.varianceRatio)
            ),
        },
        signals: [],
    };
}

export function readRegression(
    input: IndicatorReadInput
): ReadingOf<'regression'> | null {
    const found = readRegressionLevel(input.selection);
    if (found === null) return null;
    // The regime line prints the R² of the last bar that has a slope.
    const printed = input.selection.indicators.regression.findLast(
        r => r.slope !== null
    );
    return {
        kind: 'regression',
        basis: 'state',
        state: found.state,
        values: { r2: fmt(printed?.r2) },
        signals: [],
    };
}

/** σ per bar in percent units, as `## Market Regime & Risk Context` prints the volatility line. */
const sigma = (series: readonly (number | null)[]): number | null => {
    const latest = lastNonNull(series);
    return latest === null ? null : fmt(latest * PERCENT_FACTOR);
};

export function readYangZhang(
    input: IndicatorReadInput
): ReadingOf<'yang_zhang'> | null {
    const found = readYangZhangLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'yang_zhang',
        basis: 'state',
        state: found.state,
        values: { sigma: sigma(input.selection.indicators.yangZhang) },
        signals: [],
    };
}

export function readEwma(input: IndicatorReadInput): ReadingOf<'ewma'> | null {
    const found = readEwmaLevel(input.selection);
    if (found === null) return null;
    return {
        kind: 'ewma',
        basis: 'state',
        state: found.state,
        values: { sigma: sigma(input.selection.indicators.ewmaVolatility) },
        signals: [],
    };
}

/**
 * One reader per kind (exhaustive: a new `IndicatorCardKind` without one does not compile).
 * A reader returns `null` when the kind has nothing to say on this chart: an always-on line
 * the prompt printed as `N/A`, an event skill whose signals did not fire, a state that is not
 * notable.
 */
