// Attaching and reading back the measured base rate a pattern or candle card carries
// (WP-18 C4). Code decides the row (`measuredBaseRateFor`, one table); the model never
// supplies it: `normalizePatternSummary` / `normalizeCandlePatternSummary` copy known
// fields only, so a `baseRate` in a model reply is dropped before a card exists (CP-13).

import {
    asObject,
    asOptionalEnum,
    asString,
} from '@/domain/analysis/normalizePrimitives';
import {
    measuredBaseRateFor,
    type BaseRateSubject,
    type BaseRateVerdict,
    type MeasuredBaseRate,
} from '@/domain/analysis/measuredBaseRates';
import type { Timeframe } from '@/domain/types';

const SUBJECTS: readonly BaseRateSubject[] = [
    'chart_pattern',
    'candle_pattern',
    'price_level',
];
const VERDICTS: readonly BaseRateVerdict[] = [
    'beats_placebo',
    'no_edge',
    'insufficient_sample',
];

/**
 * A candle's table key from the name a card carries: lower case with separators as
 * underscores ('Bullish Engulfing', 'bullish-engulfing' -> 'bullish_engulfing'). Nothing
 * fuzzier: a name that matches no row gets the pooled candle row.
 */
export function candleBaseRateKey(patternName: string): string {
    return patternName
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
}

/**
 * @internal
 * The base rate of a chart-pattern card, by the canonical pattern id of its skill (`pattern`
 * of the skill front matter); `null` off daily bars. A card whose skill has no pattern id
 * carries the pooled row.
 */
export function patternCardBaseRate(
    skillPattern: string | undefined,
    timeframe: Timeframe
): MeasuredBaseRate | null {
    return measuredBaseRateFor('chart_pattern', skillPattern ?? '', timeframe);
}

/** @internal The base rate of a candle card, by its pattern name; `null` off daily bars. */
export function candleCardBaseRate(
    patternName: string,
    timeframe: Timeframe
): MeasuredBaseRate | null {
    return measuredBaseRateFor(
        'candle_pattern',
        candleBaseRateKey(patternName),
        timeframe
    );
}

const VERDICT_LABEL: Record<BaseRateVerdict, string> = {
    beats_placebo: 'beats placebo',
    no_edge: 'no edge over placebo',
    insufficient_sample: 'small sample',
};

/** @internal The words a prompt label uses for a verdict (`[Measured: no edge over placebo, n=612]`). */
export function baseRateVerdictLabel(verdict: BaseRateVerdict): string {
    return VERDICT_LABEL[verdict];
}

const isShare = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

const isFiniteNumber = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);

/**
 * @internal
 * A stored `baseRate` on a cache read: `null` stays `null` (not measured), a row with every
 * member valid is kept as written (a table regenerated since is not a corrupt entry), and
 * anything else is `undefined` so the card keeps its other fields and loses only the
 * figure. Never coerced: a half-formed row would print a measurement nobody made.
 */
export function normalizeCachedBaseRate(
    value: unknown
): MeasuredBaseRate | null | undefined {
    if (value === null) return null;
    const o = asObject(value);
    if (o === null) return undefined;
    const subject = asOptionalEnum(o.subject, SUBJECTS);
    const verdict = asOptionalEnum(o.verdict, VERDICTS);
    const difference = asObject(o.difference);
    const scope = asObject(o.scope);
    const key = asString(o.key);
    if (
        subject === undefined ||
        verdict === undefined ||
        key === '' ||
        !Number.isInteger(o.n) ||
        (o.n as number) < 0 ||
        !isShare(o.eventShare) ||
        !isShare(o.placeboShare) ||
        difference === null ||
        !isFiniteNumber(difference.mean) ||
        !isFiniteNumber(difference.low) ||
        !isFiniteNumber(difference.high) ||
        scope === null ||
        scope.timeframe !== '1Day' ||
        !Number.isInteger(scope.symbols) ||
        typeof scope.from !== 'string' ||
        typeof scope.to !== 'string'
    ) {
        return undefined;
    }
    return {
        subject,
        key,
        n: o.n as number,
        eventShare: o.eventShare,
        placeboShare: o.placeboShare,
        difference: {
            mean: difference.mean,
            low: difference.low,
            high: difference.high,
        },
        verdict,
        scope: {
            timeframe: '1Day',
            symbols: scope.symbols as number,
            from: scope.from,
            to: scope.to,
        },
    };
}
