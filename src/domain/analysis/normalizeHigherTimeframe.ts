import { BACKDROP_SESSIONS } from '@/domain/analysis/higherTimeframe';
import {
    asNumber,
    asObject,
    asOptionalEnum,
} from '@/domain/analysis/normalizePrimitives';
import type {
    HigherTimeframeKind,
    HigherTimeframeReading,
    MarketBackdropChange,
    MarketBackdropReading,
    Trend,
    TrendAlignment,
} from '@/domain/types';

const HIGHER_TIMEFRAME_KINDS: readonly HigherTimeframeKind[] = [
    'daily',
    'weekly',
    'monthly',
];
const TRENDS: readonly Trend[] = ['bullish', 'bearish', 'neutral'];
const ALIGNMENTS: readonly TrendAlignment[] = ['aligned', 'opposed', 'mixed'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored `null` stays `null`; a finite number stays; a missing key or anything else is `undefined` (invalid). */
function numberOrNull(value: unknown): number | null | undefined {
    return value === null ? null : asNumber(value);
}

function trendOrNull(value: unknown): Trend | null | undefined {
    return value === null ? null : asOptionalEnum(value, TRENDS);
}

/**
 * @internal
 *
 * Keep a cached `higherTimeframe` only when every member is valid and the members agree: a
 * known kind, a `null` or known trend that is `null` exactly when the slope is, a `null`
 * alignment whenever the trend is `null`, a boolean progress flag and a non-negative integer
 * bar count. A reading that fails any check is dropped whole, never coerced: a half-formed
 * reading would show a higher-timeframe picture the prompt never stated, while absence
 * already means "not computed" to a consumer.
 */
export function normalizeHigherTimeframeReading(
    value: unknown
): HigherTimeframeReading | undefined {
    const obj = asObject(value);
    if (obj === null) return undefined;
    const kind = asOptionalEnum(obj.kind, HIGHER_TIMEFRAME_KINDS);
    const trend = trendOrNull(obj.trend);
    const slopeAtr = numberOrNull(obj.slopeAtr);
    const rsi14 = numberOrNull(obj.rsi14);
    const closeVsMa50Pct = numberOrNull(obj.closeVsMa50Pct);
    const alignment =
        obj.alignment === null
            ? null
            : asOptionalEnum(obj.alignment, ALIGNMENTS);
    const bars = asNumber(obj.bars);
    if (
        kind === undefined ||
        trend === undefined ||
        slopeAtr === undefined ||
        rsi14 === undefined ||
        closeVsMa50Pct === undefined ||
        alignment === undefined ||
        typeof obj.lastBarInProgress !== 'boolean' ||
        bars === undefined ||
        !Number.isInteger(bars) ||
        bars < 0
    ) {
        return undefined;
    }
    if ((trend === null) !== (slopeAtr === null)) return undefined;
    if (trend === null && alignment !== null) return undefined;
    return {
        kind,
        trend,
        slopeAtr,
        rsi14,
        closeVsMa50Pct,
        lastBarInProgress: obj.lastBarInProgress,
        bars,
        alignment,
    };
}

function normalizeBackdropChange(
    value: unknown
): MarketBackdropChange | undefined {
    const obj = asObject(value);
    if (obj === null) return undefined;
    const sessions = BACKDROP_SESSIONS.find(s => s === obj.sessions);
    const symbolPct = numberOrNull(obj.symbolPct);
    const benchmarkPct = numberOrNull(obj.benchmarkPct);
    if (
        sessions === undefined ||
        symbolPct === undefined ||
        benchmarkPct === undefined
    ) {
        return undefined;
    }
    return { sessions, symbolPct, benchmarkPct };
}

/**
 * @internal
 *
 * Keep a cached `marketBackdrop` only when it is whole: a non-empty label, a `null` or known
 * trend, a `null` or finite distance, a `null` or `YYYY-MM-DD` end date, and exactly one valid
 * change per configured window. Anything else drops the reading (never coerced), for the reason
 * given at {@link normalizeHigherTimeframeReading}.
 */
export function normalizeMarketBackdropReading(
    value: unknown
): MarketBackdropReading | undefined {
    const obj = asObject(value);
    if (obj === null) return undefined;
    const trend = trendOrNull(obj.trend);
    const closeVsMa200Pct = numberOrNull(obj.closeVsMa200Pct);
    const endDate =
        obj.endDate === null
            ? null
            : typeof obj.endDate === 'string' && DATE_ONLY.test(obj.endDate)
              ? obj.endDate
              : undefined;
    const changes = Array.isArray(obj.relative)
        ? obj.relative.map(normalizeBackdropChange)
        : [];
    const relative = changes.flatMap(change =>
        change === undefined ? [] : [change]
    );
    if (
        typeof obj.label !== 'string' ||
        obj.label === '' ||
        trend === undefined ||
        closeVsMa200Pct === undefined ||
        endDate === undefined ||
        relative.length !== changes.length ||
        relative.length !== BACKDROP_SESSIONS.length ||
        !BACKDROP_SESSIONS.every(s =>
            relative.some(change => change.sessions === s)
        )
    ) {
        return undefined;
    }
    return { label: obj.label, trend, closeVsMa200Pct, endDate, relative };
}
