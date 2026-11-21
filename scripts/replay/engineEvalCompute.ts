/**
 * The numbers of the engine evaluation: pools, edges over the matched placebo, cluster
 * bootstrap intervals and the G1 counters of one arm. Pure functions over the events
 * `engineEvalCandles.ts` and `engineEvalPatterns.ts` produce; `engineEval.ts` writes them.
 *
 * Rules every statistic follows:
 *  - an edge is `mean_i(outcome_i − mean_k placebo_ik)` over a pool, so a pool's number is
 *    always the pattern's excess over matched random dates of the same symbol;
 *  - the interval clusters by ISO week of the event bar (market-wide moves and overlapping
 *    windows share a week), percentile, `bootstrapReplicates` resamples; the pattern D also
 *    gets a `blockWeeks`-week block interval and G3 reads the wider of the two;
 *  - the bootstrap's week list comes from the bars, not from the events, so a narrowed run
 *    (`--only`) resamples the same weeks;
 *  - a pool or family is reported with its `n`; an empty pool gives `null`, never `0`.
 */
import {
    aggregateByWeek,
    blockOfWeek,
    holmAdjust,
    intervalOf,
    pooledMean,
    recordOf,
    resampleMultiplicities,
    resampledMean,
    streamForKey,
} from './engineEvalStats';
import {
    CANDLE_VIOLATIONS,
    EVAL_CONSTANTS,
    G1_PATTERN_KEYS,
    G1_SCORED_PATTERN_KEYS,
    PRIMARY_HORIZON,
    perHorizon,
    type CandleEvent,
    type CandleViolation,
    type EvalEvent,
    type G1Gate,
    type G1PatternKey,
    type HorizonKey,
    type Observation,
    type PatternEvent,
    type PerHorizon,
    type PlaceboSummary,
} from './engineEvalTypes';
import type { PatternCounters } from './engineEvalPatterns';
import type { CaseCandleLines } from './engineEvalCandles';
import { mean } from './stats';

const { bootstrapReplicates, minFamilyN, seed, blockWeeks } = EVAL_CONSTANTS;

// ─── Statistics over observations ─────────────────────────────────────────────

export interface EdgeStat {
    n: number;
    mean: number | null;
    low: number | null;
    high: number | null;
    p: number | null;
    /** Resamples with no observation of this pool, skipped from the interval. */
    droppedReplicates: number;
}

export interface DeltaStat {
    nBefore: number;
    nAfter: number;
    delta: number | null;
    low: number | null;
    high: number | null;
    p: number | null;
    droppedReplicates: number;
}

/** A sorted cluster list (weeks or blocks) and the resamples drawn over it. */
export interface Resampling {
    keys: readonly string[];
    multiplicities: readonly (readonly number[])[];
}

/** The ISO-week bootstrap and the `blockWeeks`-week block bootstrap of one run. */
export interface Resamplings {
    weeks: Resampling;
    blocks: Resampling;
}

function resamplingOf(keys: readonly string[], stream: string): Resampling {
    return {
        keys,
        multiplicities: resampleMultiplicities(
            keys.length,
            bootstrapReplicates,
            streamForKey(seed, stream)
        ),
    };
}

/** Both bootstraps over the run's week list (from the bars, independent of `--only`). */
export function makeResamplings(weeks: readonly string[]): Resamplings {
    const blocks = [
        ...new Set(weeks.map(week => blockOfWeek(week, blockWeeks))),
    ].toSorted();
    return {
        weeks: resamplingOf(weeks, 'bootstrap|week'),
        blocks: resamplingOf(blocks, 'bootstrap|block'),
    };
}

/** The same observations clustered by block instead of week. */
export function toBlocks(observations: readonly Observation[]): Observation[] {
    return observations.map(o => ({
        ...o,
        week: blockOfWeek(o.week, blockWeeks),
    }));
}

export function edgeStat(
    observations: readonly Observation[],
    resampling: Resampling
): EdgeStat {
    const aggregate = aggregateByWeek(observations, resampling.keys);
    const interval = intervalOf(
        resampling.multiplicities.map(m => resampledMean(aggregate, m))
    );
    return { n: observations.length, mean: pooledMean(aggregate), ...interval };
}

/** `mean(after) − mean(before)`, the interval taken inside each shared resample. */
export function deltaStat(
    before: readonly Observation[],
    after: readonly Observation[],
    resampling: Resampling
): DeltaStat {
    const aggBefore = aggregateByWeek(before, resampling.keys);
    const aggAfter = aggregateByWeek(after, resampling.keys);
    const interval = intervalOf(
        resampling.multiplicities.map(m => {
            const a = resampledMean(aggAfter, m);
            const b = resampledMean(aggBefore, m);
            return a === null || b === null ? null : a - b;
        })
    );
    const meanAfter = pooledMean(aggAfter);
    const meanBefore = pooledMean(aggBefore);
    return {
        nBefore: before.length,
        nAfter: after.length,
        delta:
            meanAfter === null || meanBefore === null
                ? null
                : meanAfter - meanBefore,
        ...interval,
    };
}

/** The wider of two intervals (lower of the lows, higher of the highs); `null` if either is. */
export function widerInterval(
    a: Pick<EdgeStat, 'low' | 'high'>,
    b: Pick<EdgeStat, 'low' | 'high'>
): { low: number | null; high: number | null } {
    return {
        low: a.low === null || b.low === null ? null : Math.min(a.low, b.low),
        high:
            a.high === null || b.high === null
                ? null
                : Math.max(a.high, b.high),
    };
}

// ─── Families ─────────────────────────────────────────────────────────────────

export interface FamilyReport {
    family: string;
    n: number;
    /** Present from `minFamilyN` events on; below it the family is counted only. */
    primary: EdgeStat | null;
    /** The same edge clustered by `blockWeeks`-week blocks (patterns only). */
    primaryBlock: EdgeStat | null;
    /** Holm-adjusted p of `primary` across the reported families of its kind. */
    primaryPHolm: number | null;
    byMarket: Record<'us' | 'kr', EdgeStat> | null;
    byHalf: Record<'early' | 'late', EdgeStat> | null;
}

interface Splittable {
    market: 'us' | 'kr';
    half: 'early' | 'late';
}

/**
 * One report per family; from `minFamilyN` events a family gets its edge, its US/KR and
 * time-half splits, and a Holm-adjusted p across the families that qualify.
 */
function familyReports<E extends Splittable>(
    events: readonly E[],
    familyOf: (event: E) => string,
    observe: (own: readonly E[]) => Observation[],
    resamplings: Resamplings,
    withBlock: boolean
): FamilyReport[] {
    const names = [...new Set(events.map(familyOf))].toSorted();
    const reports = names.map((family): FamilyReport => {
        const own = events.filter(e => familyOf(e) === family);
        if (own.length < minFamilyN) {
            return {
                family,
                n: own.length,
                primary: null,
                primaryBlock: null,
                primaryPHolm: null,
                byMarket: null,
                byHalf: null,
            };
        }
        const stat = (subset: readonly E[]): EdgeStat =>
            edgeStat(observe(subset), resamplings.weeks);
        return {
            family,
            n: own.length,
            primary: stat(own),
            primaryBlock: withBlock
                ? edgeStat(toBlocks(observe(own)), resamplings.blocks)
                : null,
            primaryPHolm: null,
            byMarket: {
                us: stat(own.filter(e => e.market === 'us')),
                kr: stat(own.filter(e => e.market === 'kr')),
            },
            byHalf: {
                early: stat(own.filter(e => e.half === 'early')),
                late: stat(own.filter(e => e.half === 'late')),
            },
        };
    });
    const adjusted = holmAdjust(reports.map(r => r.primary?.p ?? null));
    return reports.map((r, i) => ({ ...r, primaryPHolm: adjusted[i] }));
}

// ─── Candle pools ─────────────────────────────────────────────────────────────

export const CANDLE_POOLS = ['bullish', 'bearish', 'pooled'] as const;
export type CandlePool = (typeof CANDLE_POOLS)[number];

type TestedCandle = CandleEvent & {
    y: PerHorizon<number>;
    pct: PerHorizon<number>;
    matched: PlaceboSummary;
    unmatched: PlaceboSummary;
};

const isTested = (event: CandleEvent): event is TestedCandle =>
    event.status === 'tested' &&
    event.y !== null &&
    event.pct !== null &&
    event.matched !== null &&
    event.unmatched !== null;

export function candlePoolEvents(
    events: readonly CandleEvent[],
    pool: CandlePool
): TestedCandle[] {
    return events
        .filter(isTested)
        .filter(
            e =>
                pool === 'pooled' ||
                e.direction === (pool === 'bullish' ? 1 : -1)
        );
}

type CandleMeasure = 'y' | 'pct';

/** `outcome − placebo mean` of each event, for one horizon. */
export function candleObservations(
    events: readonly TestedCandle[],
    measure: CandleMeasure,
    horizon: HorizonKey,
    placebo: 'matched' | 'unmatched'
): Observation[] {
    return events.map(e => ({
        week: e.week,
        value: e[measure][horizon] - e[placebo][measure][horizon],
    }));
}

/** Hit-share excess: `1[y > 0] − share of placebo dates with y > 0`. */
export function candleHitObservations(
    events: readonly TestedCandle[],
    horizon: HorizonKey
): Observation[] {
    return events.map(e => ({
        week: e.week,
        value: (e.y[horizon] > 0 ? 1 : 0) - e.matched.hit[horizon],
    }));
}

export interface CandlePoolReport {
    n: number;
    /** Primary: ATR-normalised edge at h = 5 over the matched placebo. */
    primary: EdgeStat;
    /** Holm-adjusted p of `primary` across the three pools. */
    primaryPHolm: number | null;
    horizons: PerHorizon<EdgeStat>;
    percent: PerHorizon<EdgeStat>;
    unmatchedPrimary: EdgeStat;
    hitShareEdge: EdgeStat;
    eventHitShare: number | null;
    placeboHitShare: number | null;
    byMarket: Record<'us' | 'kr', EdgeStat>;
    byHalf: Record<'early' | 'late', EdgeStat>;
}

function candlePoolReport(
    pool: readonly TestedCandle[],
    resampling: Resampling
): CandlePoolReport {
    const primaryObs = (events: readonly TestedCandle[]): Observation[] =>
        candleObservations(events, 'y', PRIMARY_HORIZON, 'matched');
    return {
        n: pool.length,
        primary: edgeStat(primaryObs(pool), resampling),
        primaryPHolm: null,
        horizons: perHorizon(h =>
            edgeStat(candleObservations(pool, 'y', h, 'matched'), resampling)
        ),
        percent: perHorizon(h =>
            edgeStat(candleObservations(pool, 'pct', h, 'matched'), resampling)
        ),
        unmatchedPrimary: edgeStat(
            candleObservations(pool, 'y', PRIMARY_HORIZON, 'unmatched'),
            resampling
        ),
        hitShareEdge: edgeStat(
            candleHitObservations(pool, PRIMARY_HORIZON),
            resampling
        ),
        eventHitShare: mean(pool.map(e => (e.y[PRIMARY_HORIZON] > 0 ? 1 : 0))),
        placeboHitShare: mean(pool.map(e => e.matched.hit[PRIMARY_HORIZON])),
        byMarket: {
            us: edgeStat(
                primaryObs(pool.filter(e => e.market === 'us')),
                resampling
            ),
            kr: edgeStat(
                primaryObs(pool.filter(e => e.market === 'kr')),
                resampling
            ),
        },
        byHalf: {
            early: edgeStat(
                primaryObs(pool.filter(e => e.half === 'early')),
                resampling
            ),
            late: edgeStat(
                primaryObs(pool.filter(e => e.half === 'late')),
                resampling
            ),
        },
    };
}

/** Robustness variants (WP-17 §7.4): reported, never gating, never used to pick values. */
export interface CandleRobustnessReport {
    priorMove: Record<
        'a05' | 'a15',
        {
            threshold: number;
            contextViolations: number;
            /** Pooled primary edge over the placebo re-matched under the threshold. */
            pooled: EdgeStat;
        }
    >;
    bodyFloor: Record<
        'f01' | 'f05',
        { floor: number; setupBodyViolations: number }
    >;
}

function robustnessReport(
    events: readonly CandleEvent[],
    resampling: Resampling
): CandleRobustnessReport {
    const [a05, a15] = EVAL_CONSTANTS.robustPriorMoveAtr;
    const [f01, f05] = EVAL_CONSTANTS.robustBodyFloorAtr;
    const thresholds = { a05, a15 };
    const floors = { f01, f05 };
    const tested = events.filter(isTested);
    return {
        priorMove: recordOf(['a05', 'a15'], key => ({
            threshold: thresholds[key],
            contextViolations: events.filter(
                e => e.robust.contextViolation[key]
            ).length,
            pooled: edgeStat(
                tested.flatMap(e => {
                    const variant = e.robust.matched[key];
                    return variant === null
                        ? []
                        : [
                              {
                                  week: e.week,
                                  value:
                                      e.y[PRIMARY_HORIZON] -
                                      variant.y[PRIMARY_HORIZON],
                              },
                          ];
                }),
                resampling
            ),
        })),
        bodyFloor: recordOf(['f01', 'f05'], key => ({
            floor: floors[key],
            setupBodyViolations: events.filter(
                e => e.robust.setupBodyViolation[key]
            ).length,
        })),
    };
}

export interface CandleReport {
    events: number;
    tested: number;
    neutral: number;
    dropped: number;
    byPattern: Record<string, number>;
    violations: Record<CandleViolation, number>;
    violationsByPattern: Record<
        string,
        Partial<Record<CandleViolation, number>>
    >;
    pools: Record<CandlePool, CandlePoolReport>;
    families: FamilyReport[];
    robustness: CandleRobustnessReport;
}

function countBy<T>(
    items: readonly T[],
    key: (item: T) => string
): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        const k = key(item);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
    }, {});
}

export function candleReport(
    events: readonly CandleEvent[],
    resamplings: Resamplings
): CandleReport {
    const resampling = resamplings.weeks;
    const reports = CANDLE_POOLS.map(pool =>
        candlePoolReport(candlePoolEvents(events, pool), resampling)
    );
    const adjusted = holmAdjust(reports.map(r => r.primary.p));
    const poolReports = recordOf(CANDLE_POOLS, pool => {
        const i = CANDLE_POOLS.indexOf(pool);
        return { ...reports[i], primaryPHolm: adjusted[i] };
    });
    const violated = events.filter(e => e.violations.length > 0);
    return {
        events: events.length,
        tested: events.filter(e => e.status === 'tested').length,
        neutral: events.filter(e => e.status === 'neutral').length,
        dropped: events.filter(e => e.status === 'dropped').length,
        byPattern: countBy(events, e => e.pattern),
        violations: recordOf(
            CANDLE_VIOLATIONS,
            code => events.filter(e => e.violations.includes(code)).length
        ),
        violationsByPattern: Object.fromEntries(
            [...new Set(violated.map(e => e.pattern))]
                .toSorted()
                .map(pattern => [
                    pattern,
                    Object.fromEntries(
                        CANDLE_VIOLATIONS.map(code => [
                            code,
                            violated.filter(
                                e =>
                                    e.pattern === pattern &&
                                    e.violations.includes(code)
                            ).length,
                        ]).filter(([, n]) => n !== 0)
                    ),
                ])
        ),
        pools: poolReports,
        families: familyReports(
            candlePoolEvents(events, 'pooled'),
            e => e.pattern,
            own => candleObservations(own, 'y', PRIMARY_HORIZON, 'matched'),
            resamplings,
            false
        ),
        robustness: robustnessReport(events, resampling),
    };
}

// ─── Pattern pools ────────────────────────────────────────────────────────────

export type PatternMeasure = 'target' | 'cons';

const hitOf = (kind: string): number => (kind === 'hit' ? 1 : 0);

/** `1[hit first] − share of placebo transplants that hit first`, per event. */
export function patternObservations(
    events: readonly PatternEvent[],
    measure: PatternMeasure
): Observation[] {
    return events.map(e => ({
        week: e.week,
        value:
            measure === 'target'
                ? hitOf(e.target60) - e.placeboTargetHit
                : hitOf(e.cons60) - e.placeboConsHit,
    }));
}

/** The audit's z: event hit share against the pooled placebo share. */
export function placeboZ(
    events: readonly PatternEvent[],
    measure: PatternMeasure
): number | null {
    const n = events.length;
    const placeboN = events.reduce((a, e) => a + e.placeboN, 0);
    if (n === 0 || placeboN === 0) return null;
    const hits = events.reduce(
        (a, e) => a + hitOf(measure === 'target' ? e.target60 : e.cons60),
        0
    );
    const p =
        events.reduce(
            (a, e) =>
                a +
                (measure === 'target' ? e.placeboTargetHit : e.placeboConsHit) *
                    e.placeboN,
            0
        ) / placeboN;
    if (!(p > 0 && p < 1)) return null;
    return (hits / n - p) / Math.sqrt((p * (1 - p)) / n);
}

export interface PatternPoolReport {
    n: number;
    /** D: target-first share minus the placebo's, ISO-week clusters. */
    target: EdgeStat;
    /** The same D clustered by `blockWeeks`-week blocks. */
    targetBlock: EdgeStat;
    /** The wider of the two intervals: what G3 reads. */
    targetWider: { low: number | null; high: number | null };
    cons: EdgeStat;
    eventTargetShare: number | null;
    placeboTargetShare: number | null;
    zTarget: number | null;
    zCons: number | null;
    byMarket: Record<'us' | 'kr', EdgeStat>;
    byHalf: Record<'early' | 'late', EdgeStat>;
}

function patternPoolReport(
    events: readonly PatternEvent[],
    resamplings: Resamplings
): PatternPoolReport {
    const target = (own: readonly PatternEvent[]): EdgeStat =>
        edgeStat(patternObservations(own, 'target'), resamplings.weeks);
    const week = target(events);
    const block = edgeStat(
        toBlocks(patternObservations(events, 'target')),
        resamplings.blocks
    );
    return {
        n: events.length,
        target: week,
        targetBlock: block,
        targetWider: widerInterval(week, block),
        cons: edgeStat(patternObservations(events, 'cons'), resamplings.weeks),
        eventTargetShare: mean(events.map(e => hitOf(e.target60))),
        placeboTargetShare: mean(events.map(e => e.placeboTargetHit)),
        zTarget: placeboZ(events, 'target'),
        zCons: placeboZ(events, 'cons'),
        byMarket: {
            us: target(events.filter(e => e.market === 'us')),
            kr: target(events.filter(e => e.market === 'kr')),
        },
        byHalf: {
            early: target(events.filter(e => e.half === 'early')),
            late: target(events.filter(e => e.half === 'late')),
        },
    };
}

/** The WP-06 `labelPatternOutcome` secondary outcome (20 bars); reported, not gating. */
export interface LabelReport {
    events: number;
    byOutcome: Record<string, number>;
    skipReasons: Record<string, number>;
    /** Labels that ran a race (target / invalidation first, ambiguous, open at horizon). */
    raced: number;
    targetFirstShare: number | null;
    meanRwNullTargetFirst: number | null;
}

const RACED = new Set([
    'target_first',
    'invalidation_first',
    'ambiguous',
    'open_at_horizon',
]);

export function labelReport(events: readonly PatternEvent[]): LabelReport {
    const labels = events.map(e => e.label20);
    const raced = labels.filter(l => RACED.has(l.outcome));
    return {
        events: events.length,
        byOutcome: countBy(labels, l => l.outcome),
        skipReasons: countBy(
            labels.filter(l => l.skipReason !== null),
            l => l.skipReason ?? ''
        ),
        raced: raced.length,
        targetFirstShare: mean(
            raced.map(l => (l.outcome === 'target_first' ? 1 : 0))
        ),
        meanRwNullTargetFirst: mean(
            labels.flatMap(l =>
                l.rwNullTargetFirst === null ? [] : [l.rwNullTargetFirst]
            )
        ),
    };
}

export interface PatternReport {
    events: number;
    directed: PatternPoolReport;
    families: FamilyReport[];
    label: LabelReport;
    counters: PatternCounters;
}

export function patternReport(
    events: readonly PatternEvent[],
    counters: PatternCounters,
    resamplings: Resamplings
): PatternReport {
    return {
        events: events.length,
        directed: patternPoolReport(events, resamplings),
        families: familyReports(
            events,
            e => e.id,
            own => patternObservations(own, 'target'),
            resamplings,
            true
        ),
        label: labelReport(events),
        counters,
    };
}

// ─── G1 ───────────────────────────────────────────────────────────────────────

export interface G1Report {
    /** The PR this run is scored for; `null` reports every counter and scores none. */
    gate: G1Gate | null;
    candle: Record<CandleViolation, number>;
    patterns: Record<G1PatternKey, number>;
    /** The counters this gate scores, by name. */
    scored: Record<string, number>;
    /** The half the gate scores was measured (an `--only` run must not score the other as 0). */
    scoredHalfMeasured: boolean;
    /** Every scored counter is 0 and the scored half was measured; `null` without a gate. */
    pass: boolean | null;
}

export function g1Report(
    candle: Record<CandleViolation, number> | null,
    counters: PatternCounters | null,
    gate: G1Gate | null
): G1Report {
    const candleCounts = recordOf(
        CANDLE_VIOLATIONS,
        code => candle?.[code] ?? 0
    );
    const patterns = recordOf(G1_PATTERN_KEYS, key => counters?.[key] ?? 0);
    const scored: Record<string, number> =
        gate === null
            ? {}
            : gate === 'c9'
              ? candleCounts
              : recordOf(G1_SCORED_PATTERN_KEYS[gate], key => patterns[key]);
    const scoredHalfMeasured =
        gate === 'c9' ? candle !== null : counters !== null;
    return {
        gate,
        candle: candleCounts,
        patterns,
        scored,
        scoredHalfMeasured,
        pass:
            gate === null
                ? null
                : scoredHalfMeasured &&
                  Object.values(scored).every(n => n === 0),
    };
}

// ─── Cases (secondary, deterministic) ─────────────────────────────────────────

export interface CaseLinesReport {
    cases: number;
    /** Cases with no bar at their `asOf` date, left out of the numbers below. */
    skipped: number;
    meanLines: number | null;
    byLineCount: Record<string, number>;
    /** Share of analyses whose printed lines carry both a bullish and a bearish pattern. */
    shareBothDirections: number | null;
}

export function caseLinesReport(
    rows: readonly CaseCandleLines[],
    skipped = 0
): CaseLinesReport {
    return {
        cases: rows.length,
        skipped,
        meanLines: mean(rows.map(r => r.lines)),
        byLineCount: countBy(rows, r => String(r.lines)),
        shareBothDirections: mean(
            rows.map(r => (r.bullish && r.bearish ? 1 : 0))
        ),
    };
}

// ─── One arm ──────────────────────────────────────────────────────────────────

export interface ArmSummary {
    arm: string;
    /** The sorted ISO weeks of the evaluated bars: the bootstrap's cluster list. */
    weeks: string[];
    candles: CandleReport | null;
    patterns: PatternReport | null;
    caseLines: CaseLinesReport | null;
    g1: G1Report;
}

export function summarizeArm(input: {
    arm: string;
    weeks: readonly string[];
    gate: G1Gate | null;
    candleEvents: readonly CandleEvent[] | null;
    patternEvents: readonly PatternEvent[] | null;
    patternCounters: PatternCounters | null;
    caseLines: readonly CaseCandleLines[] | null;
    /** Cases with no bar at their `asOf` date. */
    skippedCases?: number;
}): ArmSummary {
    const resamplings = makeResamplings(input.weeks);
    const candles =
        input.candleEvents === null
            ? null
            : candleReport(input.candleEvents, resamplings);
    return {
        arm: input.arm,
        weeks: [...input.weeks],
        candles,
        patterns:
            input.patternEvents === null || input.patternCounters === null
                ? null
                : patternReport(
                      input.patternEvents,
                      input.patternCounters,
                      resamplings
                  ),
        caseLines:
            input.caseLines === null
                ? null
                : caseLinesReport(input.caseLines, input.skippedCases ?? 0),
        g1: g1Report(
            candles?.violations ?? null,
            input.patternCounters,
            input.gate
        ),
    };
}

export const isCandleEvent = (event: EvalEvent): event is CandleEvent =>
    event.kind === 'candle';
export const isPatternEvent = (event: EvalEvent): event is PatternEvent =>
    event.kind === 'pattern';
