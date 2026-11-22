import {
    diff,
    fmt,
    lastIndicator,
    lastNonNull,
    price,
} from '@/domain/analysis/indicatorReadingFigures';
import type {
    FiredSignals,
    IndicatorCardSignal,
    IndicatorReadInput,
    ReadingOf,
    Skill,
} from '@/domain/types';

// ─── Fired signals ────────────────────────────────────────────────────────────

/**
 * The detected signals this event skill listens to: those newly lit on this bar first, then
 * the others, each group in detection order.
 */
const firedSignals = (
    skill: Skill,
    { selection, print }: IndicatorReadInput
): IndicatorCardSignal[] => {
    const gating = skill.gating;
    if (gating?.tier !== 'gated' || gating.signalKind !== 'event') return [];
    const triggers = new Set<string>(gating.triggers);
    const fired = selection.signals
        .filter(signal => triggers.has(signal.type))
        .map(signal => ({
            type: signal.type,
            phase: signal.phase,
            barsAgo: print.barCount - 1 - signal.detectedAt,
        }));
    // An event newly lit on this bar leads: a detector keeps reporting its last cross for
    // several bars, so an older opposite cross can sit earlier in detection order than the
    // one the prompt lists as newly lit. Detection order is kept within each group.
    const fresh = new Set<string>(selection.newSignalTypes ?? []);
    return [
        ...fired.filter(signal => fresh.has(signal.type)),
        ...fired.filter(signal => !fresh.has(signal.type)),
    ];
};

// ─── Event kinds ──────────────────────────────────────────────────────────────

/** The first fired signal's type and all of them, or `null` when the skill listens to none that fired. */
function fired(skill: Skill, input: IndicatorReadInput): FiredSignals | null {
    const signals = firedSignals(skill, input);
    return signals.length === 0 ? null : { state: signals[0].type, signals };
}

export function readRsi(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'rsi'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    return {
        kind: 'rsi',
        basis: 'event',
        ...hit,
        values: {
            rsi: fmt(lastIndicator(input.selection.indicators.rsi)),
        },
    };
}

export function readMacd(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'macd'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.macd);
    return {
        kind: 'macd',
        basis: 'event',
        ...hit,
        values: {
            macd: diff(last?.macd, input.print),
            signal: diff(last?.signal, input.print),
            histogram: diff(last?.histogram, input.print),
        },
    };
}

export function readCci(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'cci'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    return {
        kind: 'cci',
        basis: 'event',
        ...hit,
        values: { cci: fmt(lastNonNull(input.selection.indicators.cci)) },
    };
}

export function readCmf(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'cmf'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    return {
        kind: 'cmf',
        basis: 'event',
        ...hit,
        values: { cmf: fmt(lastNonNull(input.selection.indicators.cmf)) },
    };
}

export function readDmi(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'dmi'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.dmi);
    return {
        kind: 'dmi',
        basis: 'event',
        ...hit,
        values: {
            diPlus: fmt(last?.diPlus),
            diMinus: fmt(last?.diMinus),
            adx: fmt(last?.adx),
        },
    };
}

export function readIchimoku(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'ichimoku'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.ichimoku);
    return {
        kind: 'ichimoku',
        basis: 'event',
        ...hit,
        values: {
            tenkan: price(last?.tenkan, input.print),
            kijun: price(last?.kijun, input.print),
            senkouA: price(last?.senkouA, input.print),
            senkouB: price(last?.senkouB, input.print),
        },
    };
}

export function readMfi(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'mfi'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    return {
        kind: 'mfi',
        basis: 'event',
        ...hit,
        values: { mfi: fmt(lastIndicator(input.selection.indicators.mfi)) },
    };
}

export function readParabolicSar(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'parabolic_sar'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.parabolicSar);
    return {
        kind: 'parabolic_sar',
        basis: 'event',
        ...hit,
        values: { sar: price(last?.sar, input.print) },
    };
}

export function readSqueezeMomentum(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'squeeze_momentum'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.squeezeMomentum);
    return {
        kind: 'squeeze_momentum',
        basis: 'event',
        ...hit,
        values: { momentum: diff(last?.momentum, input.print) },
    };
}

export function readSupertrend(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'supertrend'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.supertrend);
    return {
        kind: 'supertrend',
        basis: 'event',
        ...hit,
        values: { supertrend: price(last?.supertrend, input.print) },
    };
}

export function readBollingerPercentB(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'bollinger_percent_b'> | null {
    const hit = fired(skill, input);
    if (hit === null) return null;
    const last = lastIndicator(input.selection.indicators.bollingerDerived);
    return {
        kind: 'bollinger_percent_b',
        basis: 'event',
        ...hit,
        values: { pctB: fmt(last?.pctB) },
    };
}
