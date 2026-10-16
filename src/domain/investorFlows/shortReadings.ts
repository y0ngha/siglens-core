// Readings of the short-selling inputs, shared by the short axis and the
// squeeze score so both read one computation (same staleness, rounding and
// thresholds) instead of two that could drift apart.

import {
    FTD_BASELINE_TRADING_DAYS,
    FTD_BASELINE_WINDOW_DAYS,
    FTD_MAX_AGE_DAYS,
    FTD_MIN_BASELINE_DAILY_AVERAGE,
    FTD_RECENT_WINDOW_DAYS,
    RATIO_DECIMALS,
    SHORT_INTEREST_MAX_AGE_DAYS,
    SHORT_INTEREST_TREND_MIN_CHANGE_PCT,
    SHORT_INTEREST_TREND_POINTS,
    SHORT_VOLUME_BASELINE_DAYS,
    SHORT_VOLUME_MAX_AGE_DAYS,
    SHORT_VOLUME_MIN_BASELINE_DAYS,
    THRESHOLD_LIST_MAX_AGE_DAYS,
} from '@/domain/investorFlows/constants';
import {
    daysBetween,
    formatDay,
    isFiniteNumber,
    isVisibleAsOf,
    makeStaleSignal,
    parseDay,
    roundValue,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    FailsToDeliverPoint,
    InvestorFlowsSignal,
    ShortInterestPoint,
    ShortInterestTrend,
    ShortVolumePoint,
    ThresholdListStatus,
} from '@/domain/investorFlows/types';

/** Standard deviation below which a baseline is treated as constant (no z-score). */
const MIN_STANDARD_DEVIATION = 1e-9;

export interface TrendReading {
    readonly trend: ShortInterestTrend;
    readonly changePct: number;
    readonly fromQty: number;
    readonly toQty: number;
    /** Settlement date of the first point of the trend window. */
    readonly fromDate: string;
    /** Settlement date of the last (latest) point. */
    readonly toDate: string;
}

/** Short-interest change from the previous settlement to the latest one. */
export interface LatestChangeReading {
    readonly changePct: number;
    readonly fromDate: string;
    readonly toDate: string;
}

export interface VolumeReading {
    readonly latest: ShortVolumePoint;
    readonly ratio: number;
    readonly z: number | null;
    readonly baselineMean: number | null;
    readonly baselineDays: number;
}

/** A parsable date that is not after the reference day (the shared "as of" rule). */
function isVisibleDay(date: string, asOfDay: number | null): boolean {
    const day = parseDay(date);
    return day !== null && isVisibleAsOf(day, asOfDay);
}

function sortedInterest(
    points: readonly ShortInterestPoint[],
    asOfDay: number | null
): ShortInterestPoint[] {
    return points
        .filter(
            p =>
                isVisibleDay(p.settlementDate, asOfDay) &&
                isFiniteNumber(p.shortQty) &&
                p.shortQty >= 0
        )
        .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate));
}

function sortedVolume(
    points: readonly ShortVolumePoint[],
    asOfDay: number | null
): ShortVolumePoint[] {
    return points
        .filter(
            p =>
                isVisibleDay(p.date, asOfDay) &&
                isFiniteNumber(p.shortVolume) &&
                isFiniteNumber(p.totalVolume) &&
                p.totalVolume > 0 &&
                p.shortVolume >= 0 &&
                p.shortVolume <= p.totalVolume
        )
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** Days to cover as published, else short quantity / average daily volume. */
function daysToCover(latest: ShortInterestPoint): number | null {
    if (isFiniteNumber(latest.daysToCover) && latest.daysToCover >= 0) {
        return roundValue(latest.daysToCover);
    }
    if (isFiniteNumber(latest.avgDailyVolume) && latest.avgDailyVolume > 0) {
        return roundValue(latest.shortQty / latest.avgDailyVolume);
    }
    return null;
}

function readTrend(points: readonly ShortInterestPoint[]): TrendReading | null {
    if (points.length < SHORT_INTEREST_TREND_POINTS) return null;
    const window = points.slice(-SHORT_INTEREST_TREND_POINTS);
    const first = window[0];
    const last = window[window.length - 1];
    if (first.shortQty <= 0) return null;
    const changePct = roundValue(
        ((last.shortQty - first.shortQty) / first.shortQty) * 100
    );
    const rising = window.every(
        (p, i) => i === 0 || p.shortQty > window[i - 1].shortQty
    );
    const falling = window.every(
        (p, i) => i === 0 || p.shortQty < window[i - 1].shortQty
    );
    const trend: ShortInterestTrend =
        rising && changePct >= SHORT_INTEREST_TREND_MIN_CHANGE_PCT
            ? 'rising'
            : falling && changePct <= -SHORT_INTEREST_TREND_MIN_CHANGE_PCT
              ? 'falling'
              : 'flat';
    return {
        trend,
        changePct,
        fromQty: first.shortQty,
        toQty: last.shortQty,
        fromDate: first.settlementDate,
        toDate: last.settlementDate,
    };
}

/**
 * One-settlement change (previous → latest). Rendered beside the multi-settlement
 * trend so the model does not attribute the trend's change to the previous
 * settlement alone (the GME A/B read -25.12% over three settlements as
 * "직전 정산일 대비").
 */
function readLatestChange(
    points: readonly ShortInterestPoint[]
): LatestChangeReading | null {
    if (points.length < 2) return null;
    const previous = points[points.length - 2];
    const latest = points[points.length - 1];
    if (previous.shortQty <= 0) return null;
    return {
        changePct: roundValue(
            ((latest.shortQty - previous.shortQty) / previous.shortQty) * 100
        ),
        fromDate: previous.settlementDate,
        toDate: latest.settlementDate,
    };
}

/** Latest short-volume ratio and its z-score against the preceding baseline. */
function readVolume(points: readonly ShortVolumePoint[]): VolumeReading | null {
    const latest = points.at(-1);
    if (latest === undefined) return null;
    const ratio = roundValue(
        latest.shortVolume / latest.totalVolume,
        RATIO_DECIMALS
    );
    const baseline = points
        .slice(0, -1)
        .slice(-SHORT_VOLUME_BASELINE_DAYS)
        .map(p => p.shortVolume / p.totalVolume);
    if (baseline.length < SHORT_VOLUME_MIN_BASELINE_DAYS) {
        return {
            latest,
            ratio,
            z: null,
            baselineMean: null,
            baselineDays: baseline.length,
        };
    }
    const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const variance =
        baseline.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
        (baseline.length - 1);
    const sd = Math.sqrt(variance);
    return {
        latest,
        ratio,
        z:
            sd > MIN_STANDARD_DEVIATION
                ? roundValue(
                      (latest.shortVolume / latest.totalVolume - mean) / sd
                  )
                : null,
        baselineMean: roundValue(mean, RATIO_DECIMALS),
        baselineDays: baseline.length,
    };
}

export interface StaleReading {
    readonly date: string;
    readonly ageDays: number;
    readonly maxAgeDays: number;
}

/** The newest date's age when it exceeds `maxAgeDays` before `asOfDay`; otherwise `null`. */
function staleReading(
    newestDate: string | undefined,
    asOfDay: number | null,
    maxAgeDays: number
): StaleReading | null {
    const day = newestDate === undefined ? null : parseDay(newestDate);
    if (newestDate === undefined || day === null || asOfDay === null) {
        return null;
    }
    const ageDays = daysBetween(day, asOfDay);
    return ageDays > maxAgeDays
        ? { date: newestDate, ageDays, maxAgeDays }
        : null;
}

/** Everything the short axis and the squeeze score read from FINRA data. */
export interface ShortPositioning {
    /** Fresh settlements, oldest first (empty when the feed is stale or missing). */
    readonly interest: readonly ShortInterestPoint[];
    /** Latest fresh settlement. */
    readonly latest: ShortInterestPoint | undefined;
    /** Short interest % of float of the latest settlement. */
    readonly pctFloat: number | null;
    /** Days to cover of the latest settlement. */
    readonly dtc: number | null;
    /** Trend over the last settlements. */
    readonly trend: TrendReading | null;
    /** Change from the previous settlement to the latest one. */
    readonly latestChange: LatestChangeReading | null;
    /** Latest short-volume ratio and its z-score. */
    readonly volume: VolumeReading | null;
    /** Neutral `data_stale` signals for feeds too old to score. */
    readonly staleSignals: readonly InvestorFlowsSignal[];
}

/**
 * Read the FINRA feeds as of the reference day: drop future-dated and invalid
 * rows, drop a feed whose newest point is older than its freshness gate (and
 * report it with a neutral stale signal), then compute short interest % of
 * float, days to cover, the trend and the short-volume z-score.
 */
export function readShortPositioning(
    shortInterest: readonly ShortInterestPoint[] | null,
    shortVolume: readonly ShortVolumePoint[] | null,
    floatShares: number | null,
    asOfDay: number | null
): ShortPositioning {
    const allInterest = sortedInterest(shortInterest ?? [], asOfDay);
    const allVolume = sortedVolume(shortVolume ?? [], asOfDay);
    // A feed whose newest point is too old is dropped (not scored) and reported
    // with a neutral stale signal carrying that date.
    const staleInterest = staleReading(
        allInterest.at(-1)?.settlementDate,
        asOfDay,
        SHORT_INTEREST_MAX_AGE_DAYS
    );
    const staleVolume = staleReading(
        allVolume.at(-1)?.date,
        asOfDay,
        SHORT_VOLUME_MAX_AGE_DAYS
    );
    const staleSignals = [staleInterest, staleVolume].flatMap(stale =>
        stale === null
            ? []
            : [
                  makeStaleSignal(
                      'short',
                      stale.date,
                      stale.ageDays,
                      stale.maxAgeDays
                  ),
              ]
    );
    const interest = staleInterest === null ? allInterest : [];
    const volume = staleVolume === null ? allVolume : [];
    const latest = interest.at(-1);
    return {
        interest,
        latest,
        pctFloat:
            latest !== undefined &&
            isFiniteNumber(floatShares) &&
            floatShares > 0
                ? roundValue((latest.shortQty / floatShares) * 100)
                : null,
        dtc: latest === undefined ? null : daysToCover(latest),
        trend: readTrend(interest),
        latestChange: readLatestChange(interest),
        volume: readVolume(volume),
        staleSignals,
    };
}

/** Recent fails-to-deliver figures. */
export interface FailsToDeliverReading {
    /** Largest fails quantity in the recent window (0 when the window has no fail day). */
    readonly peakQty: number;
    /** Settlement date of the peak (the newest on a tie); `null` when the recent window has no fail day. */
    readonly peakDate: string | null;
    /** {@link FailsToDeliverReading.peakQty} as % of shares outstanding; `null` without shares outstanding. */
    readonly pctOutstanding: number | null;
    /** Peak / baseline average daily fails; `null` when that average is under {@link FTD_MIN_BASELINE_DAILY_AVERAGE}. */
    readonly multiple: number | null;
}

/**
 * Read the SEC fails-to-deliver feed. Rows exist only on fail days, so a feed
 * that is present but has no row in the recent window means no fails (peak 0),
 * and the baseline average divides by trading days, not by row count. `null`
 * when the feed itself is unavailable, the reference day is unusable, or the
 * newest fail day is more than {@link FTD_MAX_AGE_DAYS} days old (stale). An
 * empty feed (`[]`) is present with no fails.
 */
export function readFailsToDeliver(
    points: readonly FailsToDeliverPoint[] | null,
    sharesOutstanding: number | null,
    asOfDay: number | null
): FailsToDeliverReading | null {
    if (points === null || asOfDay === null) return null;
    const aged = points.flatMap(p => {
        const day = parseDay(p.settlementDate);
        if (day === null || !isFiniteNumber(p.failsQty) || p.failsQty < 0) {
            return [];
        }
        const age = daysBetween(day, asOfDay);
        return age < 0 ? [] : [{ qty: p.failsQty, age, day }];
    });
    const newestAge = aged.reduce<number | null>(
        (min, p) => (min === null || p.age < min ? p.age : min),
        null
    );
    if (newestAge !== null && newestAge > FTD_MAX_AGE_DAYS) return null;
    const recent = aged.filter(p => p.age <= FTD_RECENT_WINDOW_DAYS);
    const baselineSum = aged
        .filter(
            p =>
                p.age > FTD_RECENT_WINDOW_DAYS &&
                p.age <= FTD_RECENT_WINDOW_DAYS + FTD_BASELINE_WINDOW_DAYS
        )
        .reduce((sum, p) => sum + p.qty, 0);
    // The newest day wins a tie (smaller age), so the date is deterministic for any input order.
    const peak = recent.reduce<(typeof recent)[number] | null>(
        (best, p) =>
            best === null ||
            p.qty > best.qty ||
            (p.qty === best.qty && p.age < best.age)
                ? p
                : best,
        null
    );
    const peakQty = peak?.qty ?? 0;
    const baselineDailyAverage = baselineSum / FTD_BASELINE_TRADING_DAYS;
    return {
        peakQty,
        peakDate: peak === null ? null : formatDay(peak.day),
        pctOutstanding:
            isFiniteNumber(sharesOutstanding) && sharesOutstanding > 0
                ? roundValue(
                      (peakQty / sharesOutstanding) * 100,
                      RATIO_DECIMALS
                  )
                : null,
        multiple:
            baselineDailyAverage >= FTD_MIN_BASELINE_DAILY_AVERAGE
                ? roundValue(peakQty / baselineDailyAverage)
                : null,
    };
}

/**
 * The threshold-list status as of the reference day: `null` when unavailable,
 * when its `asOf` is unparsable, after the reference day, or more than
 * {@link THRESHOLD_LIST_MAX_AGE_DAYS} days before it. A status without `asOf` is
 * taken as current (see `ThresholdListStatus`).
 */
export function readThresholdList(
    status: ThresholdListStatus | null,
    asOfDay: number | null
): ThresholdListStatus | null {
    if (status === null || status.asOf === undefined) return status;
    const day = parseDay(status.asOf);
    if (day === null || asOfDay === null) return null;
    const age = daysBetween(day, asOfDay);
    return age >= 0 && age <= THRESHOLD_LIST_MAX_AGE_DAYS ? status : null;
}
