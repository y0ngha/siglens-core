import { MS_PER_DAY } from '@/domain/constants/time';
import {
    LABEL_MILD_CUTOFF,
    LABEL_STRONG_CUTOFF,
    ROUND_DECIMALS,
    SCORE_LIMIT,
    SIGNAL_POINTS,
} from '@/domain/investorFlows/constants';
import type {
    InvestorFlowsAxisId,
    InvestorFlowsEvidence,
    InvestorFlowsLabel,
    InvestorFlowsSignal,
    InvestorFlowsSignalDirection,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
} from '@/domain/investorFlows/types';

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

const STRENGTH_RANK: Readonly<Record<InvestorFlowsSignalStrength, number>> = {
    weak: 0,
    moderate: 1,
    strong: 2,
};

/** Ascending thresholds of a magnitude; `strong` is optional for signals capped at moderate. */
export interface StrengthThresholds {
    readonly weak: number;
    readonly moderate: number;
    readonly strong?: number;
}

/** Round to `decimals` places (default {@link ROUND_DECIMALS}) and normalize `-0` to `0`. */
export function roundValue(
    value: number,
    decimals: number = ROUND_DECIMALS
): number {
    const factor = 10 ** decimals;
    const rounded = Math.round(value * factor) / factor;
    return rounded === 0 ? 0 : rounded;
}

/** `value` rounded, or `null` when it is not a finite number (DOM-1). */
export function roundOrNull(value: number | null): number | null {
    return value !== null && Number.isFinite(value) ? roundValue(value) : null;
}

/** UTC-midnight milliseconds of the leading `yyyy-mm-dd` of `text`; `null` when unparsable. */
export function parseDay(text: string): number | null {
    const match = DAY_PATTERN.exec(text);
    if (match === null) return null;
    const [, year, month, day] = match;
    const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
    // Date.UTC rolls 2026-02-31 into March; reject so a typo is not read as a real day.
    return formatDay(ms) === `${year}-${month}-${day}` ? ms : null;
}

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * UTC calendar day of a reference date. A date-only string is that day. A
 * datetime with an explicit offset (`Z`, `+09:00`) is converted to its UTC day,
 * so `2026-10-15T23:30:00-05:00` is 2026-10-16. A datetime without an offset is
 * read as UTC (its leading date). `null` when unparsable.
 */
export function parseAsOfDay(text: string): number | null {
    const leading = parseDay(text);
    if (leading === null || !OFFSET_SUFFIX.test(text.trim())) return leading;
    const instant = Date.parse(text);
    if (Number.isNaN(instant)) return null;
    const utc = new Date(instant);
    return Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** `yyyy-mm-dd` of a UTC-midnight timestamp. */
export function formatDay(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Whole calendar days from `fromMs` to `toMs` (both UTC midnights). */
export function daysBetween(fromMs: number, toMs: number): number {
    return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/**
 * Neutral signal marking a source too old to score. It carries the date of the
 * newest data point so a reader can see how stale it is.
 */
export function makeStaleSignal(
    axis: InvestorFlowsAxisId,
    date: string,
    ageDays: number,
    maxAgeDays: number
): InvestorFlowsSignal {
    return makeSignal(
        axis,
        'data_stale',
        'neutral',
        'weak',
        { ageDays, maxAgeDays },
        date
    );
}

/**
 * The shared "as of" rule: a data point is visible when its day is on or before
 * the reference day (age >= 0). Rows dated after it are dropped everywhere —
 * they never count toward sufficiency, freshness or scoring. With no reference
 * day every point is visible (the windowed axes are insufficient anyway).
 */
export function isVisibleAsOf(day: number, asOfDay: number | null): boolean {
    return asOfDay === null || day <= asOfDay;
}

/** Strength of a magnitude against ascending thresholds; `null` below `weak`. */
export function strengthOf(
    magnitude: number,
    thresholds: StrengthThresholds
): InvestorFlowsSignalStrength | null {
    if (thresholds.strong !== undefined && magnitude >= thresholds.strong) {
        return 'strong';
    }
    if (magnitude >= thresholds.moderate) return 'moderate';
    if (magnitude >= thresholds.weak) return 'weak';
    return null;
}

/** Build a signal; `subject` is omitted when there is none so equality stays structural. */
export function makeSignal(
    axis: InvestorFlowsAxisId,
    id: InvestorFlowsSignalId,
    direction: InvestorFlowsSignalDirection,
    strength: InvestorFlowsSignalStrength,
    evidence: InvestorFlowsEvidence,
    subject?: string
): InvestorFlowsSignal {
    return subject === undefined
        ? { id, axis, direction, strength, evidence }
        : { id, axis, direction, strength, evidence, subject };
}

/** Signed points a signal contributes; `neutral` signals carry none. */
export function signalPoints(signal: InvestorFlowsSignal): number {
    if (signal.direction === 'neutral') return 0;
    const points = SIGNAL_POINTS[signal.strength];
    return signal.direction === 'bullish' ? points : -points;
}

/** Clamp a score to ±{@link SCORE_LIMIT} and round it. */
export function clampScore(score: number): number {
    return roundValue(Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, score)));
}

/** Axis score: the clamped sum of the signals' points. */
export function scoreFromSignals(
    signals: readonly InvestorFlowsSignal[]
): number {
    return clampScore(signals.reduce((sum, s) => sum + signalPoints(s), 0));
}

/** Label for a score. Magnitudes exactly at a cutoff take the stronger label. */
export function labelForScore(score: number): InvestorFlowsLabel {
    if (score >= LABEL_STRONG_CUTOFF) return 'strong_bullish';
    if (score >= LABEL_MILD_CUTOFF) return 'bullish';
    if (score <= -LABEL_STRONG_CUTOFF) return 'strong_bearish';
    if (score <= -LABEL_MILD_CUTOFF) return 'bearish';
    return 'neutral';
}

/** Strongest first, then by id and subject so the order is stable across runs. */
export function sortSignals(
    signals: readonly InvestorFlowsSignal[]
): InvestorFlowsSignal[] {
    return signals
        .slice()
        .sort(
            (a, b) =>
                STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] ||
                a.id.localeCompare(b.id) ||
                (a.subject ?? '').localeCompare(b.subject ?? '')
        );
}

/** `Number.isFinite` as a type guard on `number | null | undefined`. */
export function isFiniteNumber(
    value: number | null | undefined
): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
