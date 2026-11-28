import {
    diff,
    fmt,
    lastIndicator,
    lastNonNull,
    price,
} from '@/domain/analysis/indicatorReadingFigures';
import { findCciCross } from '@/domain/signals/confirmed';
import type {
    FiredSignals,
    IndicatorCardSignal,
    IndicatorReadInput,
    ReadingOf,
    Skill,
    SkillSelectionContext,
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

/**
 * @internal Whether a CCI cross detected on bar `detectedAt` still holds on the last bar. The
 * detector reports the first cross inside its lookback, so a cross can still be listed after
 * the series went back through the level (a bullish cross through -100 two bars ago, CCI below
 * -100 again now). The level it crossed is the one the detector's own search
 * (`findCciCross`, limited to bar `detectedAt`) finds there; a signal whose level cannot be
 * found, or a series with no last value, is kept.
 */
export function cciCrossHolds(
    type: string,
    series: readonly (number | null)[],
    detectedAt: number
): boolean {
    const last = series.findLast((v): v is number => v !== null);
    if (last === undefined) return true;
    const level = findCciCross(type, series.slice(0, detectedAt + 1), 1)?.level;
    if (level === undefined) return true;
    return type === 'cci_bullish_cross' ? last > level : last < level;
}

/**
 * @internal Whether the selection's CCI cross of this type still holds; a type it does not list
 * is kept.
 */
export function cciSignalHolds(
    type: string,
    selection: SkillSelectionContext
): boolean {
    const detectedAt = selection.signals.find(d => d.type === type)?.detectedAt;
    return (
        detectedAt === undefined ||
        cciCrossHolds(type, selection.indicators.cci, detectedAt)
    );
}

export function readCci(
    input: IndicatorReadInput,
    skill: Skill
): ReadingOf<'cci'> | null {
    const listed = fired(skill, input);
    if (listed === null) return null;
    // A cross the series has undone since trails the ones that hold, so the state and the
    // description lead with a signal that can decide the card's trend (order kept within each group).
    // The hold check runs once per signal; both groups read the same verdicts.
    const holds = listed.signals.map(s =>
        cciSignalHolds(s.type, input.selection)
    );
    const signals = [
        ...listed.signals.filter((_, i) => holds[i]),
        ...listed.signals.filter((_, i) => !holds[i]),
    ];
    const hit = { state: signals[0].type, signals };
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
