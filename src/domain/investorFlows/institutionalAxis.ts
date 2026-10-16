import {
    HOLDER_COUNT_CHANGE_MODERATE_PCT,
    HOLDER_COUNT_CHANGE_STRONG_PCT,
    HOLDER_COUNT_CHANGE_WEAK_PCT,
    INSTITUTIONAL_MAX_AGE_DAYS,
    INSTITUTIONAL_MIN_HOLDERS,
    INSTITUTIONAL_MIN_PRIOR_HOLDERS,
    NET_SHARES_VS_HOLDINGS_MODERATE_PCT,
    NET_SHARES_VS_HOLDINGS_STRONG_PCT,
    NET_SHARES_VS_HOLDINGS_WEAK_PCT,
    NET_SHARES_VS_OUTSTANDING_MODERATE_PCT,
    NET_SHARES_VS_OUTSTANDING_STRONG_PCT,
    NET_SHARES_VS_OUTSTANDING_WEAK_PCT,
    NEW_VS_EXITED_MIN_EVENTS,
    NEW_VS_EXITED_MODERATE_BALANCE,
    NEW_VS_EXITED_STRONG_BALANCE,
    NEW_VS_EXITED_WEAK_BALANCE,
    PUT_CALL_MAX_STRENGTH,
    PUT_CALL_MIN_HOLDERS,
    PUT_CALL_SHIFT_MULTIPLE,
    PUT_CALL_SKEW_RATIO,
    TOP_HOLDER_CONSENSUS_MODERATE,
    TOP_HOLDER_CONSENSUS_STRONG,
    TOP_HOLDER_CONSENSUS_WEAK,
    TOP_HOLDER_COUNT,
    TOP_HOLDER_MIN_COUNT,
} from '@/domain/investorFlows/constants';
import {
    isFiniteNumber,
    labelForScore,
    makeSignal,
    isVisibleAsOf,
    makeStaleSignal,
    daysBetween,
    parseDay,
    roundOrNull,
    roundValue,
    scoreFromSignals,
    sortSignals,
    strengthOf,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    InstitutionalAxis,
    InstitutionalHolderChange,
    InstitutionalMetrics,
    InstitutionalOptionsQuarter,
    InstitutionalQuarter,
    InstitutionalSnapshot,
    NetShareChangeBasis,
    InvestorFlowsSignal,
    PartialInstitutionalQuarter,
    InvestorFlowsSignalDirection,
} from '@/domain/investorFlows/types';

const EMPTY_METRICS: InstitutionalMetrics = {
    scoredPeriod: null,
    holders: null,
    holderCountChangePct: null,
    netShareChangePct: null,
    netShareChangeBasis: null,
    newHolders: null,
    exited: null,
    newVsExitedBalance: null,
    topHolderConsensus: null,
    topHolderCount: null,
    partialQuarter: null,
    optionsPeriod: null,
    putCallValueRatio: null,
    priorPutCallValueRatio: null,
};

interface PutCallReading {
    readonly current: InstitutionalOptionsQuarter;
    readonly ratio: number;
    readonly priorRatio: number | null;
}

/** Put / call notional ratio of a quarter; `null` when it has too few filers or no notional on a side. */
function putCallRatio(q: InstitutionalOptionsQuarter): number | null {
    const numbers = [
        q.putHolders,
        q.callHolders,
        q.putValueUsd,
        q.callValueUsd,
    ];
    if (!numbers.every(isFiniteNumber)) return null;
    if (q.putHolders + q.callHolders < PUT_CALL_MIN_HOLDERS) return null;
    if (q.putValueUsd <= 0 || q.callValueUsd <= 0) return null;
    return roundValue(q.putValueUsd / q.callValueUsd);
}

/**
 * The latest complete, fresh 13F option quarter and its put / call ratio, plus
 * the ratio of the complete quarter before it. Same as-of and freshness rules as
 * the holdings quarters.
 */
function readPutCall(
    options: readonly InstitutionalOptionsQuarter[] | undefined,
    asOfDay: number | null
): PutCallReading | null {
    const complete = (options ?? [])
        .filter(q => {
            const day = parseDay(q.period);
            return (
                q.complete &&
                day !== null &&
                isVisibleAsOf(day, asOfDay) &&
                (asOfDay === null ||
                    daysBetween(day, asOfDay) <= INSTITUTIONAL_MAX_AGE_DAYS)
            );
        })
        .sort((a, b) => b.period.localeCompare(a.period));
    const [current, prior] = complete;
    const ratio = current === undefined ? null : putCallRatio(current);
    if (current === undefined || ratio === null) return null;
    return {
        current,
        ratio,
        priorRatio: prior === undefined ? null : putCallRatio(prior),
    };
}

/** Direction of a ratio that is past the skew band (or of a shift past the shift multiple); `null` inside. */
function tiltOf(
    ratio: number,
    threshold: number
): InvestorFlowsSignalDirection | null {
    if (ratio >= threshold) return 'bearish';
    if (ratio <= 1 / threshold) return 'bullish';
    return null;
}

/**
 * Weak signal from the put / call notional ratio: one-sided when the ratio is
 * past {@link PUT_CALL_SKEW_RATIO} (or its inverse), or when it moved by
 * {@link PUT_CALL_SHIFT_MULTIPLE}x versus the prior quarter. A level and a
 * shift pointing opposite ways cancel. Never stronger than weak — 13F option
 * notional is mostly hedging.
 */
function putCallSignal(reading: PutCallReading): InvestorFlowsSignal[] {
    const level = tiltOf(reading.ratio, PUT_CALL_SKEW_RATIO);
    const shift =
        reading.priorRatio === null
            ? null
            : tiltOf(
                  reading.ratio / reading.priorRatio,
                  PUT_CALL_SHIFT_MULTIPLE
              );
    if (level !== null && shift !== null && level !== shift) return [];
    const direction = level ?? shift;
    if (direction === null) return [];
    return [
        makeSignal(
            'institutional',
            'institutional_put_call_skew',
            direction,
            PUT_CALL_MAX_STRENGTH,
            {
                putCallValueRatio: reading.ratio,
                priorPutCallValueRatio: reading.priorRatio,
                putHolders: reading.current.putHolders,
                callHolders: reading.current.callHolders,
            },
            reading.current.period
        ),
    ];
}

/**
 * Whether a quarter can be scored: a parsable period and finite counts. The one
 * predicate every consumer of `quarters` uses, so the scored quarter and the
 * freshness metadata never disagree about which quarter is "latest".
 */
export function isUsableQuarter(q: InstitutionalQuarter): boolean {
    return (
        parseDay(q.period) !== null &&
        [q.holders, q.shares, q.newHolders, q.exited, q.netShareChange].every(
            isFiniteNumber
        )
    );
}

function directionOf(value: number): InvestorFlowsSignalDirection {
    return value > 0 ? 'bullish' : 'bearish';
}

/** Net share change in percent of its basis: outstanding shares when known, else prior holdings. */
function netShareChange(
    quarter: InstitutionalQuarter,
    sharesOutstanding: number | null
): { pct: number | null; basis: NetShareChangeBasis | null } {
    if (isFiniteNumber(sharesOutstanding) && sharesOutstanding > 0) {
        return {
            pct: roundValue((quarter.netShareChange / sharesOutstanding) * 100),
            basis: 'sharesOutstanding',
        };
    }
    const priorShares = quarter.shares - quarter.netShareChange;
    if (priorShares > 0) {
        return {
            pct: roundValue((quarter.netShareChange / priorShares) * 100),
            basis: 'priorHoldings',
        };
    }
    return { pct: null, basis: null };
}

function topHolderConsensus(
    holders: readonly InstitutionalHolderChange[]
): { consensus: number; count: number } | null {
    const top = holders.slice(0, TOP_HOLDER_COUNT);
    if (top.length < TOP_HOLDER_MIN_COUNT) return null;
    const up = top.filter(
        h => h.change === 'new' || h.change === 'increased'
    ).length;
    const down = top.filter(
        h => h.change === 'decreased' || h.change === 'exited'
    ).length;
    return {
        consensus: roundValue((up - down) / top.length),
        count: top.length,
    };
}

function partialSignal(
    partial: PartialInstitutionalQuarter
): InvestorFlowsSignal {
    return makeSignal(
        'institutional',
        'institutional_partial_quarter',
        'neutral',
        'weak',
        {
            holders: partial.holders,
            shares: partial.shares,
            netShareChange: partial.netShareChange,
        },
        partial.period
    );
}

/**
 * The scorable quarters, newest first: usable ({@link isUsableQuarter}) and not
 * dated after the reference day. The axis and the freshness metadata both read
 * this, so they cannot disagree about which quarter is latest.
 */
export function usableQuarters(
    quarters: readonly InstitutionalQuarter[],
    asOfDay: number | null
): InstitutionalQuarter[] {
    return quarters
        .filter(
            q =>
                isUsableQuarter(q) &&
                isVisibleAsOf(parseDay(q.period)!, asOfDay)
        )
        .sort((a, b) => b.period.localeCompare(a.period));
}

/**
 * Institutional (13F) axis.
 *
 * Sufficient means a directional input exists: the holder-count change is
 * always computable once the quarter passes the holder guards, so a sufficient
 * axis always has at least that signal source. A scored quarter older than
 * {@link INSTITUTIONAL_MAX_AGE_DAYS} before `asOfDay` is stale: the axis is
 * insufficient and carries a neutral `data_stale` signal with the period.
 *
 * When the snapshot carries 13F option positions, a weak
 * `institutional_put_call_skew` signal reads the put / call notional ratio of
 * the latest complete option quarter (see `putCallSignal`); it is only added
 * to an otherwise sufficient axis.
 *
 * Scores the latest **complete** quarter. An in-progress quarter only counts
 * the filers that have already reported, so it is surfaced as
 * `metrics.partialQuarter` plus a neutral signal and is never scored.
 */
export function evaluateInstitutionalAxis(
    snapshot: InstitutionalSnapshot,
    sharesOutstanding: number | null,
    asOfDay: number | null = null
): InstitutionalAxis {
    const quarters = usableQuarters(snapshot.quarters, asOfDay);
    const latest = quarters[0];
    const scored = quarters.find(q => q.complete);
    const partial: PartialInstitutionalQuarter | null =
        latest !== undefined && !latest.complete
            ? {
                  period: latest.period,
                  holders: latest.holders,
                  shares: latest.shares,
                  netShareChange: latest.netShareChange,
              }
            : null;
    const partialSignals: InvestorFlowsSignal[] =
        partial === null ? [] : [partialSignal(partial)];

    const insufficient = (
        metrics: InstitutionalMetrics,
        extraSignals: readonly InvestorFlowsSignal[] = []
    ): InstitutionalAxis => ({
        id: 'institutional',
        score: null,
        label: 'insufficient',
        sufficiency: 'insufficient',
        signals: [...partialSignals, ...extraSignals],
        metrics,
    });

    if (scored === undefined) {
        return insufficient({ ...EMPTY_METRICS, partialQuarter: partial });
    }

    const periodDay = parseDay(scored.period);
    const ageDays =
        asOfDay === null || periodDay === null
            ? null
            : daysBetween(periodDay, asOfDay);
    if (ageDays !== null && ageDays > INSTITUTIONAL_MAX_AGE_DAYS) {
        return insufficient(
            {
                ...EMPTY_METRICS,
                scoredPeriod: scored.period,
                holders: scored.holders,
                partialQuarter: partial,
            },
            [
                makeStaleSignal(
                    'institutional',
                    scored.period,
                    ageDays,
                    INSTITUTIONAL_MAX_AGE_DAYS
                ),
            ]
        );
    }

    // The aggregation compares each quarter with the one before it, so the
    // prior holder count follows from the counts of new and exited holders.
    const priorHolders = scored.holders - scored.newHolders + scored.exited;
    if (
        scored.holders < INSTITUTIONAL_MIN_HOLDERS ||
        priorHolders < INSTITUTIONAL_MIN_PRIOR_HOLDERS
    ) {
        return insufficient({
            ...EMPTY_METRICS,
            scoredPeriod: scored.period,
            holders: scored.holders,
            partialQuarter: partial,
        });
    }

    const holderCountChangePct = roundValue(
        ((scored.holders - priorHolders) / priorHolders) * 100
    );
    const { pct: netSharePct, basis } = netShareChange(
        scored,
        sharesOutstanding
    );
    const events = scored.newHolders + scored.exited;
    const balance =
        events >= NEW_VS_EXITED_MIN_EVENTS
            ? roundValue((scored.newHolders - scored.exited) / events)
            : null;
    const consensus =
        snapshot.topHoldersPeriod === scored.period
            ? topHolderConsensus(snapshot.topHolders)
            : null;

    const putCall = readPutCall(snapshot.options, asOfDay);
    const signals: InvestorFlowsSignal[] = [
        ...partialSignals,
        ...(putCall === null ? [] : putCallSignal(putCall)),
    ];

    const holderStrength = strengthOf(Math.abs(holderCountChangePct), {
        weak: HOLDER_COUNT_CHANGE_WEAK_PCT,
        moderate: HOLDER_COUNT_CHANGE_MODERATE_PCT,
        strong: HOLDER_COUNT_CHANGE_STRONG_PCT,
    });
    if (holderStrength !== null) {
        signals.push(
            makeSignal(
                'institutional',
                'institutional_holder_count_change',
                directionOf(holderCountChangePct),
                holderStrength,
                {
                    holders: scored.holders,
                    priorHolders,
                    changePct: holderCountChangePct,
                },
                // The scored quarter: a QoQ change needs its endpoint.
                scored.period
            )
        );
    }

    if (netSharePct !== null) {
        const onOutstanding = basis === 'sharesOutstanding';
        const strength = strengthOf(
            Math.abs(netSharePct),
            onOutstanding
                ? {
                      weak: NET_SHARES_VS_OUTSTANDING_WEAK_PCT,
                      moderate: NET_SHARES_VS_OUTSTANDING_MODERATE_PCT,
                      strong: NET_SHARES_VS_OUTSTANDING_STRONG_PCT,
                  }
                : {
                      weak: NET_SHARES_VS_HOLDINGS_WEAK_PCT,
                      moderate: NET_SHARES_VS_HOLDINGS_MODERATE_PCT,
                      strong: NET_SHARES_VS_HOLDINGS_STRONG_PCT,
                  }
        );
        if (strength !== null) {
            signals.push(
                makeSignal(
                    'institutional',
                    'institutional_net_share_change',
                    directionOf(netSharePct),
                    strength,
                    {
                        netShareChange: scored.netShareChange,
                        [onOutstanding
                            ? 'pctOfSharesOutstanding'
                            : 'pctOfPriorHoldings']: netSharePct,
                    },
                    scored.period
                )
            );
        }
    }

    if (balance !== null) {
        const strength = strengthOf(Math.abs(balance), {
            weak: NEW_VS_EXITED_WEAK_BALANCE,
            moderate: NEW_VS_EXITED_MODERATE_BALANCE,
            strong: NEW_VS_EXITED_STRONG_BALANCE,
        });
        if (strength !== null) {
            signals.push(
                makeSignal(
                    'institutional',
                    'institutional_new_vs_exited',
                    directionOf(balance),
                    strength,
                    {
                        newHolders: scored.newHolders,
                        exited: scored.exited,
                        balance,
                    }
                )
            );
        }
    }

    if (consensus !== null) {
        const strength = strengthOf(Math.abs(consensus.consensus), {
            weak: TOP_HOLDER_CONSENSUS_WEAK,
            moderate: TOP_HOLDER_CONSENSUS_MODERATE,
            strong: TOP_HOLDER_CONSENSUS_STRONG,
        });
        if (strength !== null) {
            signals.push(
                makeSignal(
                    'institutional',
                    'institutional_top_holder_consensus',
                    directionOf(consensus.consensus),
                    strength,
                    {
                        consensus: consensus.consensus,
                        topHolders: consensus.count,
                    }
                )
            );
        }
    }

    const score = scoreFromSignals(signals);
    return {
        id: 'institutional',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics: {
            scoredPeriod: scored.period,
            holders: scored.holders,
            holderCountChangePct,
            netShareChangePct: roundOrNull(netSharePct),
            netShareChangeBasis: basis,
            newHolders: scored.newHolders,
            exited: scored.exited,
            newVsExitedBalance: balance,
            topHolderConsensus: consensus?.consensus ?? null,
            topHolderCount: consensus?.count ?? null,
            partialQuarter: partial,
            optionsPeriod: putCall?.current.period ?? null,
            putCallValueRatio: putCall?.ratio ?? null,
            priorPutCallValueRatio: putCall?.priorRatio ?? null,
        },
    };
}
