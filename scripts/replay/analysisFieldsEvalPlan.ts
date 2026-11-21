/**
 * Pure parts of the `plan` mode: the plan state, the entry verdict and the stop checks
 * recomputed from OHLC and from the fields a stored result carries, their distributions,
 * the paired comparison of two runs and the statistics of a run's calls.
 *
 * The state is the design's table (WP-15 §3.3, first match wins) written out again here.
 * It reads the stored plan (zone, effective stop, effective targets) and the bars (close,
 * Wilder ATR); it never reads the stored `planState` as its own answer. The stored state is
 * only the thing compared with.
 */
import {
    EPS,
    FIELDS_EVAL_CONSTANTS as C,
    type EvalMarket,
    type GateResult,
    type Interval,
    type Share,
} from './analysisFieldsEvalTypes';
import {
    countBy,
    groupBy,
    intervalOf,
    median,
    quantilesOf,
    share,
    type Quantiles,
} from './analysisFieldsEvalCompute';
import { bucketOf, summarizePlans, type PlanSummary } from './reportCompute';
import type { CaseResultFile, LabelRow, ReplayRegime, Verdict } from './types';

export const PLAN_POSITIONS = [
    'in_zone',
    'above_zone',
    'below_zone',
    'no_setup',
] as const;
export type PlanPosition = (typeof PLAN_POSITIONS)[number];

export const NO_SETUP_REASONS = [
    'no_zone',
    'no_stop',
    'stopped',
    'no_room_above',
] as const;
export type NoSetupReason = (typeof NO_SETUP_REASONS)[number];

/** The verdict each position implies (WP-15 §3.3). Exhaustive by construction. */
export const VERDICT_BY_POSITION = {
    in_zone: 'enter',
    above_zone: 'wait',
    below_zone: 'wait',
    no_setup: 'avoid',
} as const satisfies Record<PlanPosition, Verdict>;

/** The `planState` of a stored result, as far as the comparison reads it. */
export interface StoredPlanState {
    position: string;
    reason: string | null;
    atr: number | null;
    stopDistanceAtr: number | null;
    /** Close beyond the nearer zone edge in ATR; `null` for `no_setup` and without ATR. */
    distanceAtr: number | null;
    stopBasis: string | null;
}

/** One case's plan with everything the measurement needs; built by the IO layer. */
export interface PlanCase {
    caseId: string;
    symbol: string;
    market: EvalMarket;
    regime: ReplayRegime | null;
    repeat: number;
    verdict: Verdict;
    riskLevel: string | null;
    /** Close of the analysed bar and Wilder ATR(14) there, both from OHLC. */
    close: number;
    atr: number | null;
    /** Reconciled zone prices as stored (`entryPrices`). */
    entryPrices: readonly number[];
    /** The effective stop (reconciled when present, `null` when missing or rejected). */
    stop: number | null;
    /** The model's own stop (`actionRecommendation.stopLoss`), before reconcile. */
    modelStop: number | null;
    /** The effective targets (reconciled when present). */
    targets: readonly number[];
    storedState: StoredPlanState | null;
    /** The prompt the result was generated from: its printed supports are the stop candidates. */
    promptDynamic: string | null;
    /** `planCheck.riskRewardAtEntry` when stored. */
    rrAtEntry: number | null;
    /** The 10 sessions after the analysed bar, as percent of its close; `null` without them. */
    forward: {
        changePct: number;
        lowPct: number;
        highPct: number;
        atrPct: number | null;
    } | null;
}

export interface PlanMeasure {
    caseId: string;
    repeat: number;
    verdict: Verdict;
    riskLevel: string | null;
    position: PlanPosition;
    reason: NoSetupReason | null;
    expectedVerdict: Verdict;
    atr: number | null;
    zoneLow: number | null;
    zoneTop: number | null;
    /** `(zoneLow - stop) / atr`. */
    stopDistanceAtr: number | null;
    /** `(zoneMid - stop) / atr`. */
    stopFromMidAtr: number | null;
    /** Close beyond the nearer zone edge in ATR (0 inside). */
    distanceAtr: number | null;
    /** First (lowest) target above the zone top in ATR, `null` without one. */
    firstTargetRoomAtr: number | null;
    zoneWidthAtr: number | null;
    /** The stored `planState.stopBasis`. */
    stopBasis: string | null;
    /** The basis WP-15 §3.2 prescribes for this plan; `null` when the prompt cannot tell. */
    expectedStopBasis: StopBasisName | null;
    stopTooClose: boolean | null;
    stopTooFar: boolean | null;
    /** A zone and a usable ATR but no effective stop. */
    stopMissing: boolean | null;
    /** The effective stop differs from the one §3.2 prescribes. */
    stopMismatch: boolean | null;
    /** The stop could not be checked: it depends on supports and the prompt is absent. */
    stopUnverifiable: boolean;
    levelStop: 'printed' | 'not_printed' | 'unverifiable' | null;
    /** The stored planState differs from the recomputed one in these fields; `null` without a stored state. */
    stateDiffs: readonly string[] | null;
    verdictEqual: boolean;
    /** Where the close sits against the zone, with the state table's tolerance on both sides. */
    closeVsZone: 'in' | 'above' | 'below' | null;
    /** The same as WP-15 section 1 measured it: above beyond the top x 1.01, below under the low with no tolerance. */
    closeVsZoneSection1: 'in' | 'above' | 'below' | null;
    forward: PlanCase['forward'];
    rrAtEntry: number | null;
}

/** The sessions after bar `index`, as percent of its close; `null` when the bars end first. */
export function forwardOf(
    bars: readonly { high: number; low: number; close: number }[],
    index: number,
    atr: number | null
): PlanCase['forward'] {
    const end = index + C.forwardSessions;
    if (end >= bars.length) return null;
    const close = bars[index].close;
    const window = bars.slice(index + 1, end + 1);
    return {
        changePct: (bars[end].close / close - 1) * 100,
        lowPct: (Math.min(...window.map(b => b.low)) / close - 1) * 100,
        highPct: (Math.max(...window.map(b => b.high)) / close - 1) * 100,
        atrPct: atr === null ? null : (atr / close) * 100,
    };
}

// ─── Recomputation ────────────────────────────────────────────────────────────

const positive = (v: number): boolean => Number.isFinite(v) && v > 0;

interface State {
    position: PlanPosition;
    reason: NoSetupReason | null;
}

/** The state table, first match wins. `atr` is `null` when not usable. */
export function stateOf(input: {
    zone: readonly number[];
    stop: number | null;
    targets: readonly number[];
    close: number;
    atr: number | null;
}): State {
    const { zone, stop, targets, close, atr } = input;
    if (zone.length === 0) return { position: 'no_setup', reason: 'no_zone' };
    const lo = Math.min(...zone);
    const hi = Math.max(...zone);
    if (stop === null) return { position: 'no_setup', reason: 'no_stop' };
    if (close <= stop) return { position: 'no_setup', reason: 'stopped' };
    const room = targets.some(t =>
        atr === null ? t > hi : t >= hi + C.planMinAtrSpacing * atr
    );
    if (!room) return { position: 'no_setup', reason: 'no_room_above' };
    if (close > hi * (1 + C.zoneTolerance)) {
        return { position: 'above_zone', reason: null };
    }
    if (close < lo * (1 - C.zoneTolerance)) {
        return { position: 'below_zone', reason: null };
    }
    return { position: 'in_zone', reason: null };
}

const usableAtr = (atr: number | null): number | null =>
    atr !== null && Number.isFinite(atr) && atr > 0 ? atr : null;

/**
 * The prices printed under a `Support (below):` heading of the prompt, in any horizon,
 * without the entries marked `at price` (inside bar noise, not offered as a stop). Numbers
 * elsewhere in the prompt (a moving average, a resistance, a pivot of another side) are
 * not candidates.
 */
export function printedSupports(prompt: string): readonly number[] {
    const found: number[] = [];
    let inSupport = false;
    for (const raw of prompt.split('\n')) {
        const line = raw.trim();
        if (line === 'Support (below):') {
            inSupport = true;
        } else if (inSupport && line.startsWith('- ')) {
            const price = /^-\s+(\d[\d,]*(?:\.\d+)?)/.exec(line)?.[1];
            if (price !== undefined && !line.includes('at price')) {
                found.push(Number(price.replaceAll(',', '')));
            }
        } else {
            inSupport = false;
        }
    }
    return [...new Set(found)].toSorted((x, y) => x - y);
}

/** KRX share tick sizes since 2023-01-25 (the instrument's own copy of the band table). */
const KRX_TICKS: readonly (readonly [below: number, tick: number])[] = [
    [2_000, 1],
    [5_000, 5],
    [20_000, 10],
    [50_000, 50],
    [200_000, 100],
    [500_000, 500],
    [Number.POSITIVE_INFINITY, 1_000],
];

/** A price as the market quotes it: nearest KRX tick (half up) for Korean listings, else 2 places. */
export function quotedPrice(price: number, market: EvalMarket): number {
    if (market === 'us') return Math.round(price * 100) / 100;
    const tick = KRX_TICKS.find(([below]) => price < below)?.[1] ?? 1;
    return Math.floor(price / tick + 0.5) * tick;
}

export type StopBasisName = 'model' | 'level' | 'atr';

export interface ExpectedStop {
    /** `null`: no stop (without a usable ATR and with an invalid model stop). */
    stop: number | null;
    basis: StopBasisName | null;
    /** `false` when the answer depends on supports the prompt could not give. */
    verifiable: boolean;
}

/**
 * The effective stop WP-15 §3.2 prescribes, from the model's own stop, the zone, the ATR
 * and the prompt's printed supports: the model's stop when it lies in
 * `[mid - 5 ATR, low - 1 ATR]`, else the highest printed support in that band, else
 * `low - 1.5 ATR` quoted. Without a usable ATR the legacy rule applies (positive and below
 * the zone low, else none).
 */
export function expectedStopOf(input: {
    modelStop: number | null;
    zoneLow: number;
    zoneMid: number;
    atr: number | null;
    supports: readonly number[] | null;
    market: EvalMarket;
}): ExpectedStop {
    const { modelStop, zoneLow, zoneMid, atr, supports, market } = input;
    const usable = modelStop !== null && positive(modelStop);
    if (atr === null) {
        return usable && modelStop < zoneLow
            ? { stop: modelStop, basis: 'model', verifiable: true }
            : { stop: null, basis: null, verifiable: true };
    }
    const floor = zoneMid - C.stopMaxAtrFromMid * atr;
    const ceiling = zoneLow - C.planMinAtrSpacing * atr;
    if (usable && modelStop >= floor - 1e-9 && modelStop <= ceiling + 1e-9) {
        return { stop: modelStop, basis: 'model', verifiable: true };
    }
    if (supports === null)
        return { stop: null, basis: null, verifiable: false };
    const inBand = supports.filter(
        level => level >= floor - 1e-9 && level <= ceiling + 1e-9
    );
    return inBand.length > 0
        ? { stop: Math.max(...inBand), basis: 'level', verifiable: true }
        : {
              stop: quotedPrice(zoneLow - C.stopFallbackAtr * atr, market),
              basis: 'atr',
              verifiable: true,
          };
}

const nearlyEqual = (a: number | null, b: number | null): boolean =>
    a === null || b === null
        ? a === b
        : Math.abs(a - b) <= 0.005 + 1e-6 * Math.abs(b);

function stateDiffs(
    stored: StoredPlanState,
    measured: {
        position: PlanPosition;
        reason: NoSetupReason | null;
        atr: number | null;
        stopDistanceAtr: number | null;
        distanceAtr: number | null;
        stopBasis: StopBasisName | null;
        stopBasisKnown: boolean;
    }
): readonly string[] {
    return [
        ...(stored.position === measured.position ? [] : ['position']),
        ...((stored.reason ?? null) === measured.reason ? [] : ['reason']),
        ...(nearlyEqual(stored.atr, measured.atr) ? [] : ['atr']),
        ...(nearlyEqual(stored.stopDistanceAtr, measured.stopDistanceAtr)
            ? []
            : ['stopDistanceAtr']),
        // The `no_setup` variant has no distance; the others are compared as stored.
        ...(measured.position === 'no_setup' ||
        nearlyEqual(stored.distanceAtr, measured.distanceAtr)
            ? []
            : ['distanceAtr']),
        ...(!measured.stopBasisKnown || stored.stopBasis === measured.stopBasis
            ? []
            : ['stopBasis']),
    ];
}

/** One case's recomputed state, stop checks and spacing. */
export function measurePlan(plan: PlanCase): PlanMeasure {
    const atr = usableAtr(plan.atr);
    const zone = plan.entryPrices.filter(positive);
    const stop = plan.stop !== null && positive(plan.stop) ? plan.stop : null;
    const targets = plan.targets.filter(positive);
    const { position, reason } = stateOf({
        zone,
        stop,
        targets,
        close: plan.close,
        atr,
    });
    const lo = zone.length === 0 ? null : Math.min(...zone);
    const hi = zone.length === 0 ? null : Math.max(...zone);
    // The plan's entry reference is the mean of the valid entry prices (as production does).
    const mid =
        zone.length === 0
            ? null
            : zone.reduce((a, b) => a + b, 0) / zone.length;
    const inAtr = (distance: number | null): number | null =>
        distance === null || atr === null ? null : distance / atr;
    const above = hi !== null && plan.close > hi * (1 + C.zoneTolerance);
    const below = lo !== null && plan.close < lo * (1 - C.zoneTolerance);
    // WP-15 section 1 measured "below the zone" with no tolerance (close under the low).
    const belowSection1 = lo !== null && plan.close < lo;
    const firstTarget =
        hi === null
            ? null
            : (targets.filter(t => t > hi).toSorted((a, b) => a - b)[0] ??
              null);
    const stopDistanceAtr =
        lo === null || stop === null ? null : inAtr(lo - stop);
    const supports =
        plan.promptDynamic === null
            ? null
            : printedSupports(plan.promptDynamic);
    const expected: ExpectedStop | null =
        lo === null || mid === null
            ? null
            : expectedStopOf({
                  modelStop: plan.modelStop,
                  zoneLow: lo,
                  zoneMid: mid,
                  atr,
                  supports,
                  market: plan.market,
              });
    const stopMatches =
        expected === null || atr === null || !expected.verifiable
            ? null
            : stop !== null &&
              expected.stop !== null &&
              nearlyEqual(stop, expected.stop);
    const levelStop =
        plan.storedState?.stopBasis !== 'level' || stop === null
            ? null
            : expected === null || !expected.verifiable
              ? 'unverifiable'
              : expected.basis === 'level' && stopMatches === true
                ? 'printed'
                : 'not_printed';
    const distanceAtr =
        position === 'no_setup'
            ? null
            : position === 'above_zone' && hi !== null
              ? inAtr(plan.close - hi)
              : position === 'below_zone' && lo !== null
                ? inAtr(lo - plan.close)
                : atr === null
                  ? null
                  : 0;
    return {
        caseId: plan.caseId,
        repeat: plan.repeat,
        verdict: plan.verdict,
        riskLevel: plan.riskLevel,
        position,
        reason,
        expectedVerdict: VERDICT_BY_POSITION[position],
        atr,
        zoneLow: lo,
        zoneTop: hi,
        stopDistanceAtr,
        stopFromMidAtr:
            mid === null || stop === null ? null : inAtr(mid - stop),
        distanceAtr,
        firstTargetRoomAtr:
            firstTarget === null || hi === null
                ? null
                : inAtr(firstTarget - hi),
        zoneWidthAtr: lo === null || hi === null ? null : inAtr(hi - lo),
        stopBasis: plan.storedState?.stopBasis ?? null,
        expectedStopBasis: expected?.verifiable ? expected.basis : null,
        stopTooClose:
            atr === null || stopDistanceAtr === null
                ? null
                : stopDistanceAtr < C.planMinAtrSpacing - 1e-9,
        stopTooFar:
            atr === null || stop === null || mid === null
                ? null
                : (mid - stop) / atr > C.stopMaxAtrFromMid + 1e-9,
        // A zone and a usable ATR always yield a stop, so a missing one is a violation.
        stopMissing: lo === null || atr === null ? null : stop === null,
        stopMismatch: stopMatches === null ? null : !stopMatches,
        stopUnverifiable:
            expected !== null && atr !== null && !expected.verifiable,
        levelStop,
        stateDiffs:
            plan.storedState === null
                ? null
                : stateDiffs(plan.storedState, {
                      position,
                      reason,
                      atr,
                      stopDistanceAtr,
                      distanceAtr,
                      stopBasis: expected?.verifiable ? expected.basis : null,
                      stopBasisKnown: expected?.verifiable === true,
                  }),
        verdictEqual: plan.verdict === VERDICT_BY_POSITION[position],
        closeVsZone:
            lo === null || hi === null
                ? null
                : above
                  ? 'above'
                  : below
                    ? 'below'
                    : 'in',
        closeVsZoneSection1:
            lo === null || hi === null
                ? null
                : above
                  ? 'above'
                  : belowSection1
                    ? 'below'
                    : 'in',
        forward: plan.forward,
        rrAtEntry: plan.rrAtEntry,
    };
}

// ─── Run summary ──────────────────────────────────────────────────────────────

export interface StopStats {
    /** Plans with a zone, an effective stop and a usable ATR. */
    n: number;
    fromZoneLowAtr: Quantiles;
    fromZoneMidAtr: Quantiles;
    underOneAtr: Share;
    underHalfAtr: Share;
    tooClose: number;
    tooFar: number;
    /** A zone and a usable ATR but no effective stop. */
    missing: number;
    /** The effective stop differs from the one WP-15 section 3.2 prescribes. */
    mismatch: number;
    /** Stops that could not be checked for want of the prompt. */
    unverifiable: number;
    levelStops: { printed: number; notPrinted: number; unverifiable: number };
}

export interface VolatilityRow {
    n: number;
    /** Mean 10-session high-low range in percent of the close. */
    rangePct: number | null;
    atrPct: number | null;
    changePct: number | null;
}

export interface PlanRunSummary {
    n: number;
    /** `headline`: the rows a report counts (labels needed); `all`: every result with a plan. */
    basis: 'headline' | 'all';
    positions: Record<PlanPosition, Share>;
    reasons: Record<string, number>;
    /** Stored `planState.stopBasis`, `none` when absent. */
    stopBasis: Record<string, number>;
    /** The basis section 3.2 prescribes, over plans with a zone whose prompt can tell. */
    stopBasisExpected: Record<string, number>;
    verdicts: Record<string, number>;
    verdictByPosition: Record<string, number>;
    recompute: {
        withStoredState: number;
        equal: number;
        diffsByField: Record<string, number>;
        verdictEqual: Share;
    };
    stop: StopStats;
    target: {
        firstTargetRoomAtr: Quantiles;
        atLeastOneAtr: Share;
        zoneWidthAtr: Quantiles;
    };
    /** The WP-15 §1 view: where the close sits against the zone, by stored verdict. */
    closeVsZoneByVerdict: Record<string, Record<string, number>>;
    /** The section 1 view (no tolerance below the zone); reproduces the design's figures. */
    closeVsZoneByVerdictSection1: Record<string, Record<string, number>>;
    volatility: {
        byLevel: Record<string, VolatilityRow>;
        monotonic: boolean | null;
    };
    riskReward: Quantiles;
}

function stopStats(measures: readonly PlanMeasure[]): StopStats {
    const withStop = measures.filter(
        m => m.stopDistanceAtr !== null && m.stopFromMidAtr !== null
    );
    const low = withStop.flatMap(m =>
        m.stopDistanceAtr === null ? [] : [m.stopDistanceAtr]
    );
    return {
        n: withStop.length,
        fromZoneLowAtr: quantilesOf(low),
        fromZoneMidAtr: quantilesOf(
            withStop.flatMap(m =>
                m.stopFromMidAtr === null ? [] : [m.stopFromMidAtr]
            )
        ),
        underOneAtr: share(low.filter(v => v < 1).length, low.length),
        underHalfAtr: share(low.filter(v => v < 0.5).length, low.length),
        tooClose: measures.filter(m => m.stopTooClose === true).length,
        tooFar: measures.filter(m => m.stopTooFar === true).length,
        missing: measures.filter(m => m.stopMissing === true).length,
        mismatch: measures.filter(m => m.stopMismatch === true).length,
        unverifiable: measures.filter(m => m.stopUnverifiable).length,
        levelStops: {
            printed: measures.filter(m => m.levelStop === 'printed').length,
            notPrinted: measures.filter(m => m.levelStop === 'not_printed')
                .length,
            unverifiable: measures.filter(m => m.levelStop === 'unverifiable')
                .length,
        },
    };
}

function volatilityOf(measures: readonly PlanMeasure[]): {
    byLevel: Record<string, VolatilityRow>;
    monotonic: boolean | null;
} {
    const withForward = measures.flatMap(m =>
        m.forward === null || m.riskLevel === null
            ? []
            : [{ level: m.riskLevel, f: m.forward }]
    );
    const rows = groupBy(withForward, w => w.level);
    const meanOf = (values: readonly number[]): number | null =>
        values.length === 0
            ? null
            : values.reduce((a, b) => a + b, 0) / values.length;
    const byLevel = Object.fromEntries(
        [...rows.entries()].map(([level, items]) => [
            level,
            {
                n: items.length,
                rangePct: meanOf(items.map(i => i.f.highPct - i.f.lowPct)),
                atrPct: meanOf(
                    items.flatMap(i =>
                        i.f.atrPct === null ? [] : [i.f.atrPct]
                    )
                ),
                changePct: meanOf(items.map(i => i.f.changePct)),
            },
        ])
    );
    const ordered = ['low', 'medium', 'high'].map(l => byLevel[l]?.rangePct);
    return {
        byLevel,
        monotonic: ordered.some(v => v === undefined || v === null)
            ? null
            : ordered[0] !== undefined &&
              ordered[1] !== undefined &&
              ordered[2] !== undefined &&
              ordered[0] !== null &&
              ordered[1] !== null &&
              ordered[2] !== null &&
              ordered[0] < ordered[1] &&
              ordered[1] < ordered[2],
    };
}

/**
 * Distributions and checks of one run. `headlineKeys` (`caseId#repeat`) restricts the
 * distributions to the rows a report counts; `null` uses every result with a plan.
 */
export function summarizePlanRun(
    measures: readonly PlanMeasure[],
    headlineKeys: ReadonlySet<string> | null
): PlanRunSummary {
    const rows =
        headlineKeys === null
            ? measures
            : measures.filter(m => headlineKeys.has(`${m.caseId}#${m.repeat}`));
    if (rows.length === 0) {
        throw new Error(
            'no result with a plan to measure: the run is empty or has no headline row'
        );
    }
    const withState = rows.filter(m => m.stateDiffs !== null);
    const diffFields = withState.flatMap(m => m.stateDiffs ?? []);
    const withTarget = rows.filter(m => m.firstTargetRoomAtr !== null);
    // A plan with a zone and no target above it has no room: it counts, as 0.
    const withZone = rows.filter(m => m.zoneTop !== null);
    const closeCountsBy = (
        pick: (m: PlanMeasure) => 'in' | 'above' | 'below' | null
    ): Record<string, Record<string, number>> =>
        rows.reduce<Record<string, Record<string, number>>>((acc, m) => {
            const where = pick(m);
            return where === null
                ? acc
                : {
                      ...acc,
                      [m.verdict]: {
                          ...acc[m.verdict],
                          [where]: (acc[m.verdict]?.[where] ?? 0) + 1,
                      },
                  };
        }, {});
    return {
        n: rows.length,
        basis: headlineKeys === null ? 'all' : 'headline',
        positions: Object.fromEntries(
            PLAN_POSITIONS.map(p => [
                p,
                share(rows.filter(m => m.position === p).length, rows.length),
            ])
        ) as Record<PlanPosition, Share>,
        reasons: countBy(
            rows.filter(m => m.reason !== null),
            m => m.reason ?? ''
        ),
        stopBasis: countBy(rows, m => m.stopBasis ?? 'none'),
        stopBasisExpected: countBy(
            rows.filter(m => m.expectedStopBasis !== null),
            m => m.expectedStopBasis ?? ''
        ),
        verdicts: countBy(rows, m => m.verdict),
        verdictByPosition: countBy(rows, m => `${m.verdict}>${m.position}`),
        recompute: {
            withStoredState: withState.length,
            equal: withState.filter(m => (m.stateDiffs ?? []).length === 0)
                .length,
            diffsByField: countBy(diffFields, f => f),
            verdictEqual: share(
                rows.filter(m => m.verdictEqual).length,
                rows.length
            ),
        },
        stop: stopStats(rows),
        target: {
            firstTargetRoomAtr: quantilesOf(
                withTarget.flatMap(m =>
                    m.firstTargetRoomAtr === null ? [] : [m.firstTargetRoomAtr]
                )
            ),
            atLeastOneAtr: share(
                withZone.filter(
                    m => (m.firstTargetRoomAtr ?? 0) >= C.planMinAtrSpacing
                ).length,
                withZone.length
            ),
            zoneWidthAtr: quantilesOf(
                rows.flatMap(m =>
                    m.zoneWidthAtr === null ? [] : [m.zoneWidthAtr]
                )
            ),
        },
        closeVsZoneByVerdict: closeCountsBy(m => m.closeVsZone),
        closeVsZoneByVerdictSection1: closeCountsBy(m => m.closeVsZoneSection1),
        volatility: volatilityOf(rows),
        riskReward: quantilesOf(
            rows.flatMap(m => (m.rrAtEntry === null ? [] : [m.rrAtEntry]))
        ),
    };
}

// ─── Outcomes by position ─────────────────────────────────────────────────────

/** Plan-outcome summary of the label rows of each position (`reportCompute.summarizePlans`). */
export function outcomesByPosition(
    entries: readonly { position: PlanPosition; row: LabelRow }[]
): Record<string, PlanSummary> {
    return Object.fromEntries(
        PLAN_POSITIONS.flatMap(position => {
            const rows = entries
                .filter(e => e.position === position)
                .map(e => e.row);
            return rows.length === 0
                ? []
                : [[position, summarizePlans(rows)] as const];
        })
    );
}

// ─── Runs: calls and rows ─────────────────────────────────────────────────────

export interface RunCallStats {
    n: number;
    failed: Share;
    missingPlan: Share;
    unlabelled: Share;
    ungroundedPlan: Share;
    medianOutputTokens: number | null;
    medianInputTokens: number | null;
    medianUncachedInputTokens: number | null;
    medianLatencyMs: number | null;
}

/** Failure, label and token statistics of a run; one row per case (repeat 1 only). */
export function runCallStats(
    results: readonly CaseResultFile[],
    labels: readonly LabelRow[] | null
): RunCallStats {
    const calls = results.filter(r => r.repeat === 1);
    const usage = calls.flatMap(r => (r.usage === null ? [] : [r.usage]));
    const numbers = (pick: (u: (typeof usage)[number]) => number | null) =>
        usage.flatMap(u => {
            const v = pick(u);
            return v === null ? [] : [v];
        });
    const rows = (labels ?? []).filter(r => r.repeat === 1);
    const headline = rows.filter(r => bucketOf(r) === 'headline');
    const provenance = rows.flatMap(r =>
        r.provenance === null ? [] : [r.provenance]
    );
    return {
        n: calls.length,
        failed: share(calls.filter(r => r.error !== null).length, calls.length),
        missingPlan: share(
            headline.filter(r => r.labels?.plan.reason === 'none').length,
            headline.length
        ),
        unlabelled: share(
            rows.filter(r => bucketOf(r) === 'unlabelled').length,
            rows.length
        ),
        ungroundedPlan: share(
            provenance.reduce((sum, p) => sum + p.ungrounded.plan, 0),
            provenance.reduce((sum, p) => sum + p.checked.plan, 0)
        ),
        medianOutputTokens: median(numbers(u => u.outputTokens)),
        medianInputTokens: median(numbers(u => u.inputTokens)),
        medianUncachedInputTokens: median(
            usage.flatMap(u =>
                u.inputTokens === null || u.cachedTokens === null
                    ? []
                    : [u.inputTokens - u.cachedTokens]
            )
        ),
        medianLatencyMs: median(calls.map(r => r.latencyMs)),
    };
}

// ─── Paired comparison of two runs (after against before) ─────────────────────

export interface PairedPlanComparison {
    /** P4: share of plans whose first target is at least 1 ATR above the zone top. */
    targetRoom: { before: Share; after: Share; diff: Interval };
    /** P5: `target_first - rwNullTargetFirst` over plans triggered in both runs. */
    noRegression: {
        diff: Interval;
        beforeMean: number | null;
        afterMean: number | null;
        stopFirstEarly: { before: Share; after: Share };
        notTriggered: { before: Share; after: Share };
        riskReward: { before: number | null; after: number | null };
    };
}

const byKey = <T extends { caseId: string; repeat: number }>(
    items: readonly T[]
): Map<string, T> => new Map(items.map(i => [`${i.caseId}#${i.repeat}`, i]));

function triggeredMargin(row: LabelRow): number | null {
    const plan = row.labels?.plan;
    if (plan === undefined || bucketOf(row) !== 'headline') return null;
    const triggered = [
        'target_first',
        'stop_first',
        'ambiguous',
        'open_at_horizon',
    ];
    if (!triggered.includes(plan.outcome) || plan.rwNullTargetFirst === null) {
        return null;
    }
    return Number(plan.outcome === 'target_first') - plan.rwNullTargetFirst;
}

export function comparePlanRuns(input: {
    after: readonly PlanMeasure[];
    before: readonly PlanMeasure[];
    afterLabels: readonly LabelRow[];
    beforeLabels: readonly LabelRow[];
}): PairedPlanComparison {
    const before = byKey(input.before.filter(m => m.repeat === 1));
    const pairs = input.after
        .filter(m => m.repeat === 1)
        .flatMap(after => {
            const b = before.get(`${after.caseId}#${after.repeat}`);
            return b === undefined ? [] : [{ before: b, after }];
        });
    // Every case present in both runs; a plan with no target above its zone has 0 room.
    const roomPairs = pairs;
    const has = (m: PlanMeasure): number =>
        Number((m.firstTargetRoomAtr ?? 0) >= C.planMinAtrSpacing);
    const beforeRows = byKey(input.beforeLabels.filter(r => r.repeat === 1));
    const rowPairs = input.afterLabels
        .filter(r => r.repeat === 1)
        .flatMap(after => {
            const b = beforeRows.get(`${after.caseId}#${after.repeat}`);
            return b === undefined ? [] : [{ before: b, after }];
        });
    const margins = rowPairs.flatMap(p => {
        const b = triggeredMargin(p.before);
        const a = triggeredMargin(p.after);
        return b === null || a === null ? [] : [{ before: b, after: a }];
    });
    const headlineOf = (rows: readonly LabelRow[]) =>
        rows.filter(r => r.repeat === 1 && bucketOf(r) === 'headline');
    const early = (rows: readonly LabelRow[]): Share => {
        const h = headlineOf(rows);
        return share(
            h.filter(
                r =>
                    r.labels?.plan.outcome === 'stop_first' &&
                    r.labels.plan.holdBars !== null &&
                    r.labels.plan.holdBars <= C.earlyStopSessions
            ).length,
            h.length
        );
    };
    const notTriggered = (rows: readonly LabelRow[]): Share => {
        const h = headlineOf(rows);
        return share(
            h.filter(r => r.labels?.plan.outcome === 'not_triggered').length,
            h.length
        );
    };
    const meanRr = (ms: readonly PlanMeasure[]): number | null => {
        const values = ms.flatMap(m =>
            m.rrAtEntry === null ? [] : [m.rrAtEntry]
        );
        return values.length === 0
            ? null
            : values.reduce((a, b) => a + b, 0) / values.length;
    };
    return {
        targetRoom: {
            before: share(
                roomPairs.reduce((s, p) => s + has(p.before), 0),
                roomPairs.length
            ),
            after: share(
                roomPairs.reduce((s, p) => s + has(p.after), 0),
                roomPairs.length
            ),
            diff: intervalOf(roomPairs.map(p => has(p.after) - has(p.before))),
        },
        noRegression: {
            diff: intervalOf(margins.map(p => p.after - p.before)),
            beforeMean: intervalOf(margins.map(p => p.before)).mean,
            afterMean: intervalOf(margins.map(p => p.after)).mean,
            stopFirstEarly: {
                before: early(input.beforeLabels),
                after: early(input.afterLabels),
            },
            notTriggered: {
                before: notTriggered(input.beforeLabels),
                after: notTriggered(input.afterLabels),
            },
            riskReward: {
                before: meanRr(input.before),
                after: meanRr(input.after),
            },
        },
    };
}

// ─── Plan gates ───────────────────────────────────────────────────────────────

const gate = (
    id: string,
    description: string,
    pass: boolean | null,
    value: number | string | null,
    threshold: string
): GateResult => ({ id, description, pass, value, threshold });

const pct = (value: number | null): string =>
    value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;

/** Invariant ids and their counts over the headline rows of labelled rows. */
export function invariantCounts(
    labels: readonly LabelRow[]
): Record<string, number> {
    return countBy(
        labels.filter(r => r.repeat === 1).flatMap(r => r.invariants),
        id => id
    );
}

export interface PlanGateInput {
    /** Headline rows when labels exist (P2), else every result. */
    summary: PlanRunSummary;
    /** Every result with a plan: the stop, state and basis checks (P1, P3) are not about headline rows. */
    summaryAll: PlanRunSummary;
    paired: PairedPlanComparison | null;
    after: RunCallStats;
    before: RunCallStats | null;
    invariantsAfter: Record<string, number> | null;
    invariantsBefore: Record<string, number> | null;
    /** Noise floor in absolute share (0.01 is 1 pp); added to the side-effect margin. */
    noiseFloor: number;
}

/** P1 to P6 (P7 is a reading, see `p7Sample`). A gate the input cannot decide is `pass: null`. */
export function planGates(input: PlanGateInput): readonly GateResult[] {
    const g = C.gates;
    const { summary, summaryAll, paired, after, before } = input;
    const recompute = summaryAll.recompute;
    const stateMismatch =
        recompute.withStoredState === 0
            ? summaryAll.n
            : summaryAll.n -
              recompute.equal +
              (summaryAll.n - recompute.withStoredState);
    const shares = Object.values(summary.positions).map(s => s.share ?? 0);
    const noSetup = summary.positions.no_setup.share;
    const basisTotal = Object.values(summaryAll.stopBasisExpected).reduce(
        (sum, n) => sum + n,
        0
    );
    const atrShare =
        basisTotal === 0
            ? null
            : (summaryAll.stopBasisExpected.atr ?? 0) / basisTotal;
    const margin = Math.max(g.planSideEffectMinPp, input.noiseFloor);
    const rateDiffs =
        before === null
            ? null
            : (
                  [
                      ['failed', after.failed, before.failed],
                      ['unlabelled', after.unlabelled, before.unlabelled],
                      ['missingPlan', after.missingPlan, before.missingPlan],
                      [
                          'ungroundedPlan',
                          after.ungroundedPlan,
                          before.ungroundedPlan,
                      ],
                  ] as const
              ).map(([name, a, b]) => ({
                  name,
                  diff:
                      a.share === null || b.share === null
                          ? null
                          : a.share - b.share,
              }));
    const tokenGrowth =
        before === null ||
        after.medianOutputTokens === null ||
        before.medianOutputTokens === null ||
        before.medianOutputTokens === 0
            ? null
            : after.medianOutputTokens / before.medianOutputTokens - 1;
    // Compared as a product, not as `ratio - 1 <= limit`: 1100 / 1000 - 1 is 0.10000000000000009.
    const tokensOk =
        before === null ||
        after.medianOutputTokens === null ||
        before.medianOutputTokens === null
            ? null
            : after.medianOutputTokens <=
              before.medianOutputTokens * (1 + g.planMaxOutputTokenGrowth);
    const newInvariants =
        input.invariantsAfter === null || input.invariantsBefore === null
            ? null
            : Object.entries(input.invariantsAfter)
                  .filter(([id, n]) => n > (input.invariantsBefore?.[id] ?? 0))
                  .map(([id]) => id);
    const stop = summaryAll.stop;
    const p1Violations =
        stop.tooClose +
        stop.tooFar +
        stop.missing +
        stop.mismatch +
        stop.levelStops.notPrinted +
        stop.unverifiable +
        stateMismatch +
        (summaryAll.recompute.verdictEqual.n -
            summaryAll.recompute.verdictEqual.count) +
        (newInvariants?.length ?? 0);
    // Without a baseline for the invariants the gate cannot say "no new violation".
    const p1Pass =
        p1Violations > 0 ? false : newInvariants === null ? null : true;
    return [
        gate(
            'P1',
            'stop equals the prescribed one (band, highest printed support), recomputed state, basis and verdict equal the stored ones, no new plan-invariant violation (every result with a plan)',
            p1Pass,
            `too close ${stop.tooClose}, too far ${stop.tooFar}, stop missing ${stop.missing}, stop differs from section 3.2 ${stop.mismatch}, level stop not the highest printed support ${stop.levelStops.notPrinted}, unverifiable ${stop.unverifiable}, state mismatch ${stateMismatch}/${summaryAll.n}, verdict mismatch ${summaryAll.n - summaryAll.recompute.verdictEqual.count}, new invariants ${newInvariants === null ? 'n/a (no --before labels)' : newInvariants.join(',') || 'none'}`,
            'all 0'
        ),
        gate(
            'P2',
            'no position above 70% of rows; no_setup between 2% and 35%',
            noSetup === null
                ? null
                : Math.max(...shares) <= g.planMaxPositionShare &&
                      noSetup >= g.planNoSetupMin &&
                      noSetup <= g.planNoSetupMax,
            PLAN_POSITIONS.map(
                p => `${p} ${pct(summary.positions[p].share)}`
            ).join(', '),
            `each <= ${g.planMaxPositionShare * 100}%, no_setup ${g.planNoSetupMin * 100}% to ${g.planNoSetupMax * 100}%`
        ),
        gate(
            'P3',
            'recomputed stop basis atr share of plans with a zone',
            atrShare === null ? null : atrShare <= g.planMaxAtrBasisShare,
            pct(atrShare),
            `<= ${g.planMaxAtrBasisShare * 100}%`
        ),
        gate(
            'P4',
            'first target at least 1 ATR above the zone top, paired, after minus before',
            paired === null
                ? null
                : paired.targetRoom.diff.low !== null &&
                      paired.targetRoom.diff.mean !== null &&
                      paired.targetRoom.diff.mean >=
                          g.planMinTargetRoomGainPp &&
                      paired.targetRoom.diff.low > 0,
            paired === null
                ? null
                : `${pct(paired.targetRoom.diff.mean)} (95% low ${pct(paired.targetRoom.diff.low)}, n ${paired.targetRoom.diff.n})`,
            `mean >= +${g.planMinTargetRoomGainPp * 100} pp and 95% low > 0`
        ),
        gate(
            'P5',
            '(target_first - random-walk null) over plans triggered in both runs, after minus before',
            paired === null
                ? null
                : paired.noRegression.diff.low !== null &&
                      paired.noRegression.diff.low >= g.planMinNoRegressionPp,
            paired === null
                ? null
                : `${pct(paired.noRegression.diff.mean)} (95% low ${pct(paired.noRegression.diff.low)}, n ${paired.noRegression.diff.n})`,
            `95% low >= ${g.planMinNoRegressionPp * 100} pp`
        ),
        gate(
            'P6',
            'failed, unlabelled, missing-plan and ungrounded-plan rates and median output tokens, after minus before',
            rateDiffs === null ||
                tokensOk === null ||
                rateDiffs.some(d => d.diff === null)
                ? null
                : rateDiffs.every(d => (d.diff ?? 0) <= margin + EPS) &&
                      tokensOk,
            rateDiffs === null
                ? null
                : `${rateDiffs.map(d => `${d.name} ${d.diff === null ? 'n/a' : `${(d.diff * 100).toFixed(2)} pp`}`).join(', ')}, output tokens ${tokenGrowth === null ? 'n/a' : pct(tokenGrowth)}`,
            `each rate <= +${(margin * 100).toFixed(2)} pp (max of 1 pp and the noise floor), output tokens <= +${g.planMaxOutputTokenGrowth * 100}%`
        ),
    ];
}
