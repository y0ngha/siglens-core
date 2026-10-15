import {
    DAYS_TO_COVER_MODERATE,
    DAYS_TO_COVER_WEAK,
    RATIO_DECIMALS,
    SHORT_INTEREST_PCT_FLOAT_MODERATE,
    SHORT_INTEREST_PCT_FLOAT_WEAK,
    SHORT_INTEREST_TREND_MIN_CHANGE_PCT,
    SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT,
    SHORT_INTEREST_TREND_POINTS,
    SHORT_INTEREST_TREND_STRONG_CHANGE_PCT,
    SHORT_VOLUME_BASELINE_DAYS,
    SHORT_VOLUME_MIN_BASELINE_DAYS,
    SHORT_VOLUME_Z_MODERATE,
    SHORT_VOLUME_Z_WEAK,
    SHORT_INTEREST_MAX_AGE_DAYS,
    SHORT_VOLUME_MAX_AGE_DAYS,
    SQUEEZE_MIN_DAYS_TO_COVER,
    SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT,
    SQUEEZE_STRONG_DAYS_TO_COVER,
    SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT,
} from '@/domain/investorFlows/constants';
import {
    daysBetween,
    isFiniteNumber,
    isVisibleAsOf,
    labelForScore,
    makeSignal,
    makeStaleSignal,
    parseDay,
    roundValue,
    scoreFromSignals,
    sortSignals,
    strengthOf,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    InvestorFlowsSignal,
    ShortAxis,
    ShortInterestPoint,
    ShortInterestTrend,
    ShortMetrics,
    ShortVolumePoint,
} from '@/domain/investorFlows/types';

/** Standard deviation below which a baseline is treated as constant (no z-score). */
const MIN_STANDARD_DEVIATION = 1e-9;

interface TrendReading {
    readonly trend: ShortInterestTrend;
    readonly changePct: number;
    readonly fromQty: number;
    readonly toQty: number;
}

interface VolumeReading {
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
    return { trend, changePct, fromQty: first.shortQty, toQty: last.shortQty };
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

interface StaleReading {
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

/**
 * Short-selling axis from FINRA data.
 *
 * Short interest (twice a month, ~8 business days late) gives the level and
 * trend; daily Reg SHO short volume covers **off-exchange (TRF) trades only**
 * and includes market-maker hedging, so its z-score is capped at a moderate
 * signal. High short interest scores bearish (positioning against the stock);
 * the squeeze-risk signal is `neutral` because it flags upside volatility risk,
 * not direction.
 *
 * **Sufficient means a directional input exists**: short interest as a percent
 * of float, the short-interest trend, or the short-volume z-score. Days to cover
 * alone is context (it only emits a neutral signal), so it cannot make the axis
 * sufficient or let it join the composite as a fake zero.
 *
 * **Freshness:** a short-interest feed whose newest settlement is older than
 * {@link SHORT_INTEREST_MAX_AGE_DAYS}, or a short-volume feed whose newest day
 * is older than {@link SHORT_VOLUME_MAX_AGE_DAYS}, is not scored; each emits a
 * neutral `data_stale` signal carrying its newest date. The axis is
 * insufficient when no fresh directional input remains.
 *
 * **Squeeze risk** needs short interest of at least
 * {@link SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT} percent of float, days to cover
 * of at least {@link SQUEEZE_MIN_DAYS_TO_COVER} (the *level* of the latest
 * settlement, not its change) and a rising short-interest trend. There is no
 * price condition because the snapshot carries no price.
 */
export function evaluateShortAxis(
    shortInterest: readonly ShortInterestPoint[] | null,
    shortVolume: readonly ShortVolumePoint[] | null,
    floatShares: number | null,
    asOfDay: number | null = null
): ShortAxis {
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

    const pctFloat =
        latest !== undefined && isFiniteNumber(floatShares) && floatShares > 0
            ? roundValue((latest.shortQty / floatShares) * 100)
            : null;
    const dtc = latest === undefined ? null : daysToCover(latest);
    const trend = readTrend(interest);
    const volumeReading = readVolume(volume);
    const z = volumeReading?.z ?? null;

    const signals: InvestorFlowsSignal[] = [];

    const levelStrength = strengthOf(pctFloat ?? 0, {
        weak: SHORT_INTEREST_PCT_FLOAT_WEAK,
        moderate: SHORT_INTEREST_PCT_FLOAT_MODERATE,
    });
    if (pctFloat !== null && levelStrength !== null) {
        signals.push(
            makeSignal(
                'short',
                'short_interest_level',
                'bearish',
                levelStrength,
                {
                    shortInterestPctFloat: pctFloat,
                    shortQty: latest?.shortQty ?? null,
                    floatShares,
                }
            )
        );
    }

    const trendStrength =
        trend === null || trend.trend === 'flat'
            ? null
            : strengthOf(Math.abs(trend.changePct), {
                  weak: SHORT_INTEREST_TREND_MIN_CHANGE_PCT,
                  moderate: SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT,
                  strong: SHORT_INTEREST_TREND_STRONG_CHANGE_PCT,
              });
    if (trend !== null && trendStrength !== null) {
        signals.push(
            makeSignal(
                'short',
                'short_interest_trend',
                trend.trend === 'rising' ? 'bearish' : 'bullish',
                trendStrength,
                {
                    changePct: trend.changePct,
                    fromShortQty: trend.fromQty,
                    toShortQty: trend.toQty,
                    settlements: SHORT_INTEREST_TREND_POINTS,
                }
            )
        );
    }

    const dtcStrength = strengthOf(dtc ?? 0, {
        weak: DAYS_TO_COVER_WEAK,
        moderate: DAYS_TO_COVER_MODERATE,
    });
    if (dtc !== null && dtcStrength !== null) {
        signals.push(
            makeSignal('short', 'days_to_cover_high', 'neutral', dtcStrength, {
                daysToCover: dtc,
            })
        );
    }

    const zStrength =
        z === null
            ? null
            : strengthOf(Math.abs(z), {
                  weak: SHORT_VOLUME_Z_WEAK,
                  moderate: SHORT_VOLUME_Z_MODERATE,
              });
    if (z !== null && zStrength !== null && volumeReading !== null) {
        signals.push(
            makeSignal(
                'short',
                'off_exchange_short_ratio_z',
                z > 0 ? 'bearish' : 'bullish',
                zStrength,
                {
                    shortVolumeRatio: volumeReading.ratio,
                    z,
                    baselineMeanRatio: volumeReading.baselineMean,
                    baselineDays: volumeReading.baselineDays,
                }
            )
        );
    }

    const squeezeRisk =
        pctFloat !== null &&
        dtc !== null &&
        trend?.trend === 'rising' &&
        pctFloat >= SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT &&
        dtc >= SQUEEZE_MIN_DAYS_TO_COVER;
    if (squeezeRisk) {
        const strong =
            pctFloat >= SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT &&
            dtc >= SQUEEZE_STRONG_DAYS_TO_COVER;
        signals.push(
            makeSignal(
                'short',
                'short_squeeze_risk',
                'neutral',
                strong ? 'strong' : 'moderate',
                {
                    shortInterestPctFloat: pctFloat,
                    daysToCover: dtc,
                    shortInterestChangePct: trend.changePct,
                }
            )
        );
    }

    const metrics: ShortMetrics = {
        shortInterestPctFloat: pctFloat,
        daysToCover: dtc,
        shortInterestChangePct: trend?.changePct ?? null,
        shortInterestTrend: trend?.trend ?? null,
        shortVolumeRatio: volumeReading?.ratio ?? null,
        shortVolumeRatioZ: z,
        shortVolumeBaselineDays:
            z === null ? null : (volumeReading?.baselineDays ?? null),
        squeezeRisk,
    };
    const sufficient = pctFloat !== null || trend !== null || z !== null;
    if (!sufficient) {
        return {
            id: 'short',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: sortSignals(staleSignals),
            metrics,
        };
    }
    const score = scoreFromSignals(signals);
    return {
        id: 'short',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals([...signals, ...staleSignals]),
        metrics,
    };
}
