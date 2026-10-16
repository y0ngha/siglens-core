import {
    DAYS_TO_COVER_MODERATE,
    DAYS_TO_COVER_WEAK,
    FTD_MIN_QTY,
    FTD_PCT_OUTSTANDING_MODERATE,
    FTD_PCT_OUTSTANDING_WEAK,
    FTD_RECENT_WINDOW_DAYS,
    FTD_SPIKE_MIN_MULTIPLE,
    SHORT_INTEREST_PCT_FLOAT_MODERATE,
    SHORT_INTEREST_PCT_FLOAT_WEAK,
    SHORT_INTEREST_TREND_MIN_CHANGE_PCT,
    SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT,
    SHORT_INTEREST_TREND_POINTS,
    SHORT_INTEREST_TREND_STRONG_CHANGE_PCT,
    SHORT_VOLUME_Z_MODERATE,
    SHORT_VOLUME_Z_WEAK,
    SQUEEZE_MIN_DAYS_TO_COVER,
    SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT,
    SQUEEZE_SIGNAL_EVIDENCE_COMPONENTS,
    SQUEEZE_STRONG_DAYS_TO_COVER,
    SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT,
    THRESHOLD_LIST_CLOSE_OUT_DAYS,
} from '@/domain/investorFlows/constants';
import {
    labelForScore,
    makeSignal,
    scoreFromSignals,
    sortSignals,
    strengthOf,
} from '@/domain/investorFlows/scoreHelpers';
import {
    readFailsToDeliver,
    readShortPositioning,
    readThresholdList,
    type FailsToDeliverReading,
    type ShortPositioning,
} from '@/domain/investorFlows/shortReadings';
import type {
    FailsToDeliverPoint,
    InvestorFlowsSignal,
    ShortAxis,
    ShortInterestPoint,
    ShortMetrics,
    ShortVolumePoint,
    SqueezeRiskScore,
    ThresholdListStatus,
} from '@/domain/investorFlows/types';

/** Inputs of the short axis beyond the FINRA feeds; every field is optional so older call sites keep working. */
export interface ShortAxisExtras {
    /** SEC fails-to-deliver days; `null`/absent when unavailable. */
    readonly failsToDeliver?: readonly FailsToDeliverPoint[] | null;
    /** Shares outstanding, the basis of the FTD percent (Reg SHO uses it too). */
    readonly sharesOutstanding?: number | null;
    /** Threshold-list status; `null`/absent when excluded or unavailable. */
    readonly thresholdList?: ThresholdListStatus | null;
    /**
     * Price-aware squeeze score. When present it decides `short_squeeze_risk`
     * (level `high` → moderate, `extreme` → strong); absent keeps the price-free rule.
     */
    readonly squeeze?: SqueezeRiskScore;
}

/** Neutral FTD signal; capped at moderate and held at weak when the peak is chronic rather than new. */
function failsToDeliverSignal(
    reading: FailsToDeliverReading | null
): InvestorFlowsSignal[] {
    if (
        reading === null ||
        reading.pctOutstanding === null ||
        reading.peakQty < FTD_MIN_QTY
    ) {
        return [];
    }
    const levelStrength = strengthOf(reading.pctOutstanding, {
        weak: FTD_PCT_OUTSTANDING_WEAK,
        moderate: FTD_PCT_OUTSTANDING_MODERATE,
    });
    if (levelStrength === null) return [];
    const chronic =
        reading.multiple !== null && reading.multiple < FTD_SPIKE_MIN_MULTIPLE;
    return [
        makeSignal(
            'short',
            'fails_to_deliver_elevated',
            'neutral',
            chronic ? 'weak' : levelStrength,
            {
                peakFailsQty: reading.peakQty,
                pctOfSharesOutstanding: reading.pctOutstanding,
                baselineMultiple: reading.multiple,
                recentWindowDays: FTD_RECENT_WINDOW_DAYS,
            },
            // The peak's own settlement date: evidence is numeric, and quoting the
            // peak with the latest file date misdates it.
            reading.peakDate ?? undefined
        ),
    ];
}

/** Neutral threshold-list signal; moderate from the mandatory close-out day. */
function thresholdListSignal(
    status: ThresholdListStatus | null
): InvestorFlowsSignal[] {
    if (status === null || !status.listed) return [];
    return [
        makeSignal(
            'short',
            'reg_sho_threshold_listed',
            'neutral',
            status.consecutiveDays >= THRESHOLD_LIST_CLOSE_OUT_DAYS
                ? 'moderate'
                : 'weak',
            {
                consecutiveDays: status.consecutiveDays,
                closeOutDays: THRESHOLD_LIST_CLOSE_OUT_DAYS,
            },
            status.markets.join(', ') || undefined
        ),
    ];
}

/** Squeeze signal from the price-aware score: `high` is moderate, `extreme` strong. */
function scoredSqueezeSignal(
    squeeze: SqueezeRiskScore
): InvestorFlowsSignal | null {
    if (
        squeeze.score === null ||
        (squeeze.level !== 'high' && squeeze.level !== 'extreme')
    ) {
        return null;
    }
    const top = squeeze.components
        .slice(0, SQUEEZE_SIGNAL_EVIDENCE_COMPONENTS)
        .map(c => [c.id, c.value] as const);
    return makeSignal(
        'short',
        'short_squeeze_risk',
        'neutral',
        squeeze.level === 'extreme' ? 'strong' : 'moderate',
        { squeezeScore: squeeze.score, ...Object.fromEntries(top) }
    );
}

/** The price-free squeeze rule: crowded, hard to cover and growing. */
function priceFreeSqueezeSignal(
    positioning: ShortPositioning
): InvestorFlowsSignal | null {
    const { pctFloat, dtc, trend } = positioning;
    if (
        pctFloat === null ||
        dtc === null ||
        trend?.trend !== 'rising' ||
        pctFloat < SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT ||
        dtc < SQUEEZE_MIN_DAYS_TO_COVER
    ) {
        return null;
    }
    const strong =
        pctFloat >= SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT &&
        dtc >= SQUEEZE_STRONG_DAYS_TO_COVER;
    return makeSignal(
        'short',
        'short_squeeze_risk',
        'neutral',
        strong ? 'strong' : 'moderate',
        {
            shortInterestPctFloat: pctFloat,
            daysToCover: dtc,
            shortInterestChangePct: trend.changePct,
        }
    );
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
 * `SHORT_INTEREST_MAX_AGE_DAYS`, or a short-volume feed whose newest day
 * is older than `SHORT_VOLUME_MAX_AGE_DAYS`, is not scored (see `readShortPositioning`); each emits a
 * neutral `data_stale` signal carrying its newest date. The axis is
 * insufficient when no fresh directional input remains.
 *
 * **Squeeze risk** needs short interest of at least
 * {@link SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT} percent of float, days to cover
 * of at least {@link SQUEEZE_MIN_DAYS_TO_COVER} (the *level* of the latest
 * settlement, not its change) and a rising short-interest trend. There is no
 * price condition because the snapshot carries no price. When
 * `extras.squeeze` is given the signal comes from that score instead (see
 * `evaluateSqueezeRisk`), so the squeeze thresholds live in one place.
 *
 * **SEC fails to deliver and Reg SHO lists** add neutral context signals:
 * `fails_to_deliver_elevated` (peak recent fails as % of shares outstanding,
 * with the peak's settlement date as `subject`, held at weak when the peak is under {@link FTD_SPIKE_MIN_MULTIPLE}x the
 * baseline; capped at moderate because fails are not evidence of naked short
 * selling) and `reg_sho_threshold_listed`. Being neutral, they never make the
 * axis sufficient, but they are reported even when it is insufficient (for
 * example with the FINRA feeds switched off).
 */
export function evaluateShortAxis(
    shortInterest: readonly ShortInterestPoint[] | null,
    shortVolume: readonly ShortVolumePoint[] | null,
    floatShares: number | null,
    asOfDay: number | null = null,
    extras: ShortAxisExtras = {}
): ShortAxis {
    const positioning = readShortPositioning(
        shortInterest,
        shortVolume,
        floatShares,
        asOfDay
    );
    const {
        latest,
        pctFloat,
        dtc,
        trend,
        volume: volumeReading,
        staleSignals,
    } = positioning;
    const z = volumeReading?.z ?? null;
    const ftd = readFailsToDeliver(
        extras.failsToDeliver ?? null,
        extras.sharesOutstanding ?? null,
        asOfDay
    );
    const thresholdList = readThresholdList(
        extras.thresholdList ?? null,
        asOfDay
    );

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
                },
                // The window's endpoints: a change quoted without them gets
                // attributed to the previous settlement alone.
                `${trend.fromDate} to ${trend.toDate}`
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

    const squeezeSignal =
        extras.squeeze === undefined
            ? priceFreeSqueezeSignal(positioning)
            : scoredSqueezeSignal(extras.squeeze);
    const squeezeRisk = squeezeSignal !== null;
    const contextSignals: InvestorFlowsSignal[] = [
        ...failsToDeliverSignal(ftd),
        ...thresholdListSignal(thresholdList),
        ...(squeezeSignal === null ? [] : [squeezeSignal]),
    ];

    const metrics: ShortMetrics = {
        shortInterestPctFloat: pctFloat,
        daysToCover: dtc,
        shortInterestChangePct: trend?.changePct ?? null,
        shortInterestChangeFromDate: trend?.fromDate ?? null,
        shortInterestChangeToDate: trend?.toDate ?? null,
        shortInterestLatestChangePct:
            positioning.latestChange?.changePct ?? null,
        shortInterestLatestChangeFromDate:
            positioning.latestChange?.fromDate ?? null,
        shortInterestLatestChangeToDate:
            positioning.latestChange?.toDate ?? null,
        shortInterestTrend: trend?.trend ?? null,
        shortVolumeRatio: volumeReading?.ratio ?? null,
        shortVolumeRatioZ: z,
        shortVolumeBaselineDays:
            z === null ? null : (volumeReading?.baselineDays ?? null),
        squeezeRisk,
        failsToDeliverPeakQty: ftd?.peakQty ?? null,
        failsToDeliverPeakDate: ftd?.peakDate ?? null,
        failsToDeliverPctOutstanding: ftd?.pctOutstanding ?? null,
        failsToDeliverMultiple: ftd?.multiple ?? null,
        thresholdListed: thresholdList?.listed ?? null,
        thresholdConsecutiveDays: thresholdList?.consecutiveDays ?? null,
    };
    const sufficient = pctFloat !== null || trend !== null || z !== null;
    if (!sufficient) {
        return {
            id: 'short',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: sortSignals([...staleSignals, ...contextSignals]),
            metrics,
        };
    }
    const score = scoreFromSignals(signals);
    return {
        id: 'short',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals([...signals, ...contextSignals, ...staleSignals]),
        metrics,
    };
}
