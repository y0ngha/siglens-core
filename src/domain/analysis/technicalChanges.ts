import { computeAnalysisTrend } from '@/domain/analysis/analysisTrend';
import { planEntryPrice } from '@/domain/analysis/ai-levels';
import { buildPlanCheck } from '@/domain/analysis/planCheck';
import { buildPlanState } from '@/domain/analysis/planState';
import { findAnchorBarIndex } from '@/domain/analysis/priorAnalysis';
import {
    asArray,
    asIsoDate,
    asNumber,
    asObject,
    asOptionalEnum,
} from '@/domain/analysis/normalizePrimitives';
import { alertablePlanLevels } from '@/domain/analysis/priceLevelAlert';
import { calculateIndicators } from '@/domain/indicators';
import { confirmedSignalTimeline } from '@/domain/signals/timeline';
import { isInfoDepthAllowed } from '@/domain/tier';
import type {
    ActionRecommendation,
    Bar,
    ConfirmedSignalType,
    IndicatorResult,
    NoSetupReason,
    PlanPosition,
    PlanState,
    SignalDirection,
    Tier,
    TierConfig,
    Trend,
} from '@/domain/types';

/**
 * What changed in the technical reading between two daily closes.
 *
 * Every item is a fact about bars and about the levels of one reference analysis, decided by
 * the same rules the analysis card uses: the computed trend (`computeAnalysisTrend`), the plan
 * position (`buildPlanState`, inclusive edges, no tolerance), the episode-start rule of
 * `detectNewConfirmedSignals`, and the tie rules of `planCheck` for support/resistance. Nothing
 * here asks a model and nothing is a forecast (DOM-12): a line says what the closes did, never
 * what they will do.
 *
 * Pure: bars and the reference come from the caller.
 */

/**
 * @internal Most sessions between the baseline bar and the last bar. The daily bars cache
 * holds about this many sessions, so an older baseline cannot be measured and reports
 * `too_old` instead of a partial answer.
 */
export const TECHNICAL_CHANGES_MAX_SESSIONS = 250;

/** Levels and plan of one analysis, read with the depth of the tier that may see them. */
export interface ChangeReference {
    /** ISO timestamp the analysis was made. */
    readonly analyzedAt: string;
    /** Finite positive support prices, ascending, without duplicates. Empty when the depth hides them. */
    readonly supports: readonly number[];
    /** Finite positive resistance prices, ascending, without duplicates. Empty when the depth hides them. */
    readonly resistances: readonly number[];
    /** The plan; `null` when the depth hides entry or stop, or the analysis has no plan. */
    readonly plan: ActionRecommendation | null;
}

/** Who may see the reference: a tier (its info depth applies) or input already filtered for this reader. */
export type ChangeReferenceAccess =
    { readonly tier: Tier; readonly config?: TierConfig } | 'as_shown';

/** A level of the reference plan: the invalidation (stop) or an entry zone edge. */
export type PlanLevelName = 'stop' | 'entry_low' | 'entry_high';

export type TechnicalChange =
    | {
          readonly kind: 'trend_changed';
          readonly from: Trend;
          readonly to: Trend;
          /** Slope of the new reading (EMA20 move in ATR over the lookback, 2 dp). */
          readonly slopeAtr: number;
      }
    | {
          readonly kind: 'signal_started';
          readonly type: ConfirmedSignalType;
          readonly direction: SignalDirection;
          /** `Bar.time` of the bar the signal began on. */
          readonly time: number;
      }
    | {
          readonly kind: 'level_crossed';
          readonly side: 'support' | 'resistance';
          readonly price: number;
          /** `down`: the close moved to the lower side of the level; `up`: to the upper side. */
          readonly direction: 'down' | 'up';
          /** `Bar.time` of the first close on the other side. */
          readonly time: number;
          readonly close: number;
          /**
           * Whether the close at the last bar is still on the crossed side, by the same tie
           * rule as the crossing. `false`: the level was crossed and the price came back.
           */
          readonly pastNow: boolean;
      }
    | {
          readonly kind: 'plan_level_crossed';
          /** `stop`: the invalidation level; `entry_low` / `entry_high`: the entry zone edges. */
          readonly level: PlanLevelName;
          readonly price: number;
          /** `down`: the close moved to the lower side of the level; `up`: to the upper side. */
          readonly direction: 'down' | 'up';
          /** `Bar.time` of the first close on the other side. */
          readonly time: number;
          readonly close: number;
          /** Whether the close at the last bar is still on the crossed side (same tie rule). */
          readonly pastNow: boolean;
      }
    | {
          readonly kind: 'plan_position_changed';
          readonly from: PlanPosition;
          readonly to: PlanPosition;
          /** Why the plan is `no_setup` at the last bar; only when `to` is `no_setup`. */
          readonly reason?: NoSetupReason;
          /** `Bar.time` of the last bar. */
          readonly time: number;
          readonly close: number;
      };

export type TechnicalChangesResult =
    | {
          readonly ok: false;
          /**
           * `too_short`: fewer than 2 bars; `too_old`: the baseline is more than
           * 250 sessions back; `same_session`: the baseline
           * is the last bar; `invalid`: `fromIndex` is not a bar index or a close is unusable.
           */
          readonly reason: 'too_short' | 'too_old' | 'same_session' | 'invalid';
      }
    | {
          readonly ok: true;
          readonly fromTime: number;
          readonly toTime: number;
          /**
           * Close of the baseline bar, which is the close of the analysis's session: for an
           * analysis made during that session it can come after the analysis, and a crossing
           * between the analysis time and that close is not reported.
           */
          readonly closeFrom: number;
          readonly closeTo: number;
          readonly changes: readonly TechnicalChange[];
          /**
           * Whether the computed trend could be read at both ends. `false` means `changes`
           * holds no `trend_changed` because the rule was not measurable (too few bars, an
           * unusable EMA or ATR), not because the label stayed the same (DOM-12).
           */
          readonly trendMeasured: boolean;
          /**
           * Sessions after the baseline whose new-signal question could not be answered: the
           * day or the day before it could not be evaluated (fewer than 2 bars in its window,
           * a non-finite close inside it, or bars not strictly increasing in time). A signal
           * that started on such a day is missing from `changes`; `0` means every session was judged.
           */
          readonly unevaluatedSignalDays: number;
          /**
           * Bars after the baseline whose close is not a finite positive number. They were
           * skipped by the level crossings (they neither cross nor hide a later crossing);
           * `0` means every close was read.
           */
          readonly skippedCloses: number;
      };

export interface TechnicalChangesOptions {
    /** Index of the baseline bar in `bars`. `bars.length - 2` is "yesterday's close against today's". */
    readonly fromIndex: number;
    /** Levels and plan to compare against; without one no level or plan item is produced. */
    readonly reference?: ChangeReference | null;
    /** Restricts `signal_started` to these types; every confirmed type when absent. */
    readonly signalTypes?: readonly ConfirmedSignalType[];
}

const MIN_BARS = 2;

const isFinitePositive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Finite positive prices, ascending, unique. */
function ascendingPrices(values: readonly unknown[]): number[] {
    return [...new Set(values.filter(isFinitePositive))].sort((a, b) => a - b);
}

function pricesOfLevels(raw: unknown): number[] {
    return ascendingPrices(
        asArray(raw).map(level => asNumber(asObject(level)?.price))
    );
}

const STOP_BASES = ['level', 'atr'] as const;

/**
 * The plan of a stored analysis, keeping only what the plan state reads (entry prices, stop,
 * targets, the reconciled stop and targets). Text fields are not needed and are not carried.
 * `null` when the object has no usable entry price.
 */
function planOf(raw: unknown): ActionRecommendation | null {
    const o = asObject(raw);
    if (o === null) return null;
    const entryPrices = ascendingPrices(asArray(o.entryPrices));
    if (entryPrices.length === 0) return null;
    const levels = asObject(o.reconciledLevels);
    const takeProfitPrices = ascendingPrices(asArray(o.takeProfitPrices));
    const reconciledTargets =
        levels === null
            ? undefined
            : ascendingPrices(asArray(levels.takeProfitPrices));
    const reconciledStop =
        levels === null ? undefined : asNumber(levels.stopLoss);
    const stopBasis =
        levels === null
            ? undefined
            : asOptionalEnum(levels.stopBasis, STOP_BASES);
    const stopLoss = asNumber(o.stopLoss);
    return {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        entryPrices,
        ...(stopLoss !== undefined ? { stopLoss } : {}),
        takeProfitPrices,
        ...(levels !== null
            ? {
                  reconciledLevels: {
                      exit: '',
                      riskReward: '',
                      reason: '',
                      ...(reconciledStop !== undefined
                          ? { stopLoss: reconciledStop }
                          : {}),
                      ...(Array.isArray(levels.takeProfitPrices)
                          ? { takeProfitPrices: reconciledTargets }
                          : {}),
                      ...(levels.stopLossRejected === true
                          ? { stopLossRejected: true as const }
                          : {}),
                      ...(stopBasis !== undefined ? { stopBasis } : {}),
                  },
              }
            : {}),
    };
}

/** An ISO string or epoch milliseconds as an ISO string; `null` when it is neither. */
function fallbackTime(value: string | number | undefined): string | null {
    if (typeof value === 'string') return asIsoDate(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

/**
 * Reads a stored analysis (`analysis_history.result`, a cached result, or a tool-result
 * projection of one) into the levels and plan {@link technicalChangesBetween} compares against.
 *
 * Defensive like the cache normalizers: a price that is not finite and positive is dropped one
 * at a time; an input that is not an object, or has no parsable analysis time, gives `null`.
 * The analysis time is the object's own `analyzedAt`; when it has none (a tool-result
 * projection drops it, an `analysis_history` row keeps it in `generated_at`) the caller's
 * `options.analyzedAt` (an ISO string or epoch milliseconds) is used instead.
 *
 * With `{ tier }` the tier's info depth applies, by the same rule `filterAnalysisResult` uses
 * (`isInfoDepthAllowed`): key levels need `partial_detail`, the plan needs `entry` and
 * `stoploss` (the plan state reads the stop, so a tier that cannot see the stop does not get
 * a plan state derived from it). What the depth hides comes back empty (`[]` / `null`), never
 * as a different value. `'as_shown'` is for input already filtered for this reader (a stored
 * tool result): whatever is present is kept.
 *
 * @param stored - A stored analysis result (`unknown`: a database row's JSON).
 * @param access - The reader's tier (and optional config), or `'as_shown'`.
 * @param options - `analyzedAt`: the analysis time to use when `stored` has none of its own.
 * @returns The reference, or `null` when the input is not a readable analysis.
 */
export function changeReferenceOf(
    stored: unknown,
    access: ChangeReferenceAccess,
    options: { readonly analyzedAt?: string | number } = {}
): ChangeReference | null {
    const o = asObject(stored);
    if (o === null) return null;
    const analyzedAt =
        asIsoDate(o.analyzedAt) ?? fallbackTime(options.analyzedAt);
    if (analyzedAt === null) return null;

    const allowed = (depth: 'partial_detail' | 'entry' | 'stoploss'): boolean =>
        access === 'as_shown' ||
        isInfoDepthAllowed(access.tier, depth, access.config);

    const keyLevels = allowed('partial_detail') ? asObject(o.keyLevels) : null;
    const plan =
        allowed('entry') && allowed('stoploss')
            ? planOf(o.actionRecommendation)
            : null;
    return {
        analyzedAt,
        supports: keyLevels === null ? [] : pricesOfLevels(keyLevels.support),
        resistances:
            keyLevels === null ? [] : pricesOfLevels(keyLevels.resistance),
        plan,
    };
}

/**
 * Index of the bar an analysis belongs to: the last bar that starts at or before
 * `analyzedAt`. `Bar.time` is in seconds and the timestamp in milliseconds; the conversion
 * lives in `barTimeMs`.
 *
 * That bar's close is the baseline of {@link technicalChangesBetween}: for an analysis made
 * during the session it is the close that came after the analysis, and a crossing between the
 * analysis time and that close is not reported.
 *
 * The match is by bar start time only; this function knows no market session. When daily bars
 * are stamped at the start of their session date (UTC midnight, the usual input shape), an
 * analysis made on that date before the market opens still picks that bar, although its session
 * had not started (and the analysis saw only the previous close). A caller that needs "the
 * last bar closed at analysis time" resolves the session date itself and passes bars that end
 * at it.
 *
 * @param bars - Daily bars, oldest first.
 * @param analyzedAt - ISO timestamp of the analysis.
 * @returns The bar index, or `null` for an unparsable timestamp or one before every bar.
 */
export function anchorBarIndexOf(
    bars: readonly Bar[],
    analyzedAt: string
): number | null {
    const iso = asIsoDate(analyzedAt);
    if (iso === null) return null;
    return findAnchorBarIndex(bars, Date.parse(iso));
}

function trendChange(
    bars: readonly Bar[],
    barsFrom: readonly Bar[],
    indicatorsFrom: IndicatorResult,
    indicatorsTo: IndicatorResult
): { readonly measured: boolean; readonly change: TechnicalChange | null } {
    const from = computeAnalysisTrend(barsFrom, indicatorsFrom);
    const to = computeAnalysisTrend(bars, indicatorsTo);
    if (from === null || to === null) return { measured: false, change: null };
    if (from.trend === to.trend) return { measured: true, change: null };
    return {
        measured: true,
        change: {
            kind: 'trend_changed',
            from: from.trend,
            to: to.trend,
            slopeAtr: to.slopeAtr,
        },
    };
}

function planStateAt(
    plan: ActionRecommendation,
    bar: Bar,
    indicators: IndicatorResult,
    index: number
): PlanState | null {
    const check = buildPlanCheck(
        plan,
        bar.close,
        planEntryPrice(plan, bar.close)
    );
    if (check === null) return null;
    return buildPlanState(plan, check, indicators.atr[index] ?? null);
}

function planChange(
    plan: ActionRecommendation,
    bars: readonly Bar[],
    fromIndex: number,
    indicatorsFrom: IndicatorResult,
    indicatorsTo: IndicatorResult
): TechnicalChange | null {
    const last = bars.length - 1;
    const before = planStateAt(
        plan,
        bars[fromIndex],
        indicatorsFrom,
        fromIndex
    );
    const after = planStateAt(plan, bars[last], indicatorsTo, last);
    if (before === null || after === null) return null;
    const reasonOf = (state: PlanState): NoSetupReason | undefined =>
        state.position === 'no_setup' ? state.reason : undefined;
    const reason = reasonOf(after);
    if (before.position === after.position && reasonOf(before) === reason) {
        return null;
    }
    return {
        kind: 'plan_position_changed',
        from: before.position,
        to: after.position,
        ...(reason !== undefined ? { reason } : {}),
        time: bars[last].time,
        close: bars[last].close,
    };
}

/**
 * Which side of a level a close is on, by the tie rules of the plan check: a close at or
 * below a support is below it, one at or above a resistance is above it.
 */
function sideOfLevel(
    close: number,
    side: 'support' | 'resistance',
    price: number
): 'upper' | 'lower' {
    if (side === 'support') return close <= price ? 'lower' : 'upper';
    return close >= price ? 'upper' : 'lower';
}

type LevelCrossing = Extract<TechnicalChange, { kind: 'level_crossed' }>;
type PlanLevelCrossing = Extract<
    TechnicalChange,
    { kind: 'plan_level_crossed' }
>;

interface Crossing {
    readonly direction: 'down' | 'up';
    readonly time: number;
    readonly close: number;
    readonly pastNow: boolean;
}

/**
 * The first close after the baseline on the other side of a level than the baseline close,
 * and whether the last close is still on that side. `null` when no close crossed. Corrupt
 * closes are skipped (DOM-1): they neither cross a level nor hide a later crossing.
 */
function firstCrossing(
    bars: readonly Bar[],
    fromIndex: number,
    side: 'support' | 'resistance',
    price: number
): Crossing | null {
    const start = sideOfLevel(bars[fromIndex].close, side, price);
    const crossing = bars
        .slice(fromIndex + 1)
        .filter(bar => isFinitePositive(bar.close))
        .find(bar => sideOfLevel(bar.close, side, price) !== start);
    if (crossing === undefined) return null;
    const last = bars[bars.length - 1];
    return {
        direction: start === 'upper' ? 'down' : 'up',
        time: crossing.time,
        close: crossing.close,
        pastNow: sideOfLevel(last.close, side, price) !== start,
    };
}

function levelChanges(
    bars: readonly Bar[],
    fromIndex: number,
    reference: ChangeReference
): LevelCrossing[] {
    const levels = [
        ...reference.supports.map(price => ({
            side: 'support' as const,
            price,
        })),
        ...reference.resistances.map(price => ({
            side: 'resistance' as const,
            price,
        })),
    ];
    return levels
        .flatMap(({ side, price }): LevelCrossing[] => {
            const crossing = firstCrossing(bars, fromIndex, side, price);
            if (crossing === null) return [];
            return [{ kind: 'level_crossed', side, price, ...crossing }];
        })
        .sort((a, b) => a.time - b.time || a.price - b.price);
}

/**
 * The tie rule of each plan level, as the plan check reads it: a close at or below the stop is
 * a broken stop and a close at or below the zone's high edge is not above the zone (both read
 * like a support); a close at or above the zone's low edge is not below the zone (like a
 * resistance).
 */
const PLAN_LEVEL_SIDE = {
    stop: 'support',
    entry_low: 'resistance',
    entry_high: 'support',
} as const satisfies Record<PlanLevelName, 'support' | 'resistance'>;

const PLAN_LEVEL_ORDER: readonly PlanLevelName[] = [
    'stop',
    'entry_low',
    'entry_high',
];

function planLevelChanges(
    bars: readonly Bar[],
    fromIndex: number,
    plan: ActionRecommendation
): PlanLevelCrossing[] {
    const { entryZone, invalidation } = alertablePlanLevels(plan);
    const prices: Record<PlanLevelName, number | null> = {
        stop: invalidation,
        entry_low: entryZone?.low ?? null,
        entry_high: entryZone?.high ?? null,
    };
    return PLAN_LEVEL_ORDER.flatMap((level): PlanLevelCrossing[] => {
        const price = prices[level];
        if (price === null) return [];
        const crossing = firstCrossing(
            bars,
            fromIndex,
            PLAN_LEVEL_SIDE[level],
            price
        );
        if (crossing === null) return [];
        return [{ kind: 'plan_level_crossed', level, price, ...crossing }];
    }).sort(
        (a, b) =>
            a.time - b.time ||
            a.price - b.price ||
            PLAN_LEVEL_ORDER.indexOf(a.level) -
                PLAN_LEVEL_ORDER.indexOf(b.level)
    );
}

function signalChanges(
    bars: readonly Bar[],
    fromIndex: number,
    signalTypes: readonly ConfirmedSignalType[] | undefined
): { readonly changes: TechnicalChange[]; readonly unevaluated: number } {
    const days = confirmedSignalTimeline(bars, {
        days: bars.length - fromIndex,
    });
    const wanted =
        signalTypes === undefined ? null : new Set<string>(signalTypes);
    // The baseline day has no earlier day to compare with, and a day that could not be
    // evaluated (`null`) proves neither a start nor its absence: those days are counted.
    const unevaluated = days.filter(
        (day, offset) =>
            offset > 0 &&
            (day.signals === null || days[offset - 1].signals === null)
    ).length;
    const changes = days.flatMap((day, offset): TechnicalChange[] => {
        const previous = days[offset - 1];
        if (previous === undefined || previous.signals === null) return [];
        if (day.signals === null) return [];
        const before = new Set<string>(previous.signals.map(s => s.type));
        const seen = new Set<string>();
        return day.signals.flatMap((signal): TechnicalChange[] => {
            if (before.has(signal.type) || seen.has(signal.type)) return [];
            if (wanted !== null && !wanted.has(signal.type)) return [];
            seen.add(signal.type);
            return [
                {
                    kind: 'signal_started',
                    // The timeline keeps `phase === 'confirmed'` signals only, so the type is a confirmed one.
                    type: signal.type as ConfirmedSignalType,
                    direction: signal.direction,
                    time: day.time,
                },
            ];
        });
    });
    return { changes, unevaluated };
}

/**
 * What changed in the technical reading between the close of `bars[fromIndex]` and the close
 * of the last bar. Descriptive only.
 *
 * Order: `plan_position_changed`, `level_crossed` (by time), `plan_level_crossed` (by time,
 * then price), `trend_changed`, `signal_started` (by time).
 * - trend: the computed trend (`computeAnalysisTrend`) on `bars[0..fromIndex]` and on all
 *   bars; an item only when both ends are measurable and the label differs.
 * - signals: confirmed signals that start on a bar after `fromIndex` (episode-start rule of
 *   `detectNewConfirmedSignals`, evaluated per bar with `confirmedSignalTimeline`, so a signal
 *   already confirmed on the baseline bar is not new and one that ended and restarted is);
 *   `signalTypes` restricts the set.
 * - levels: per reference level, the first close after the baseline on the other side of it
 *   than the baseline close (the tie rules of the plan check: a close at or below a support is
 *   below it, at or above a resistance is above it). A level crossed and crossed back is
 *   reported once, with its first crossing; `pastNow` says whether the last close is still on
 *   the crossed side (same tie rule), so "crossed down on 11-18" is never read as "below now".
 * - plan levels: with a reference plan, the stop (`alertablePlanLevels().invalidation`) and the
 *   entry zone's low and high edges get the same first-crossing rule as `level_crossed`
 *   (stop and zone high: a close at or below is on the lower side; zone low: a close at or
 *   above is on the upper side), each with `pastNow`. A plan level never crossed gives no item.
 *   A stop that is not below the zone's low, or a rejected or absent one, is not a plan level, so
 *   it gives no `stop` item: the absence of a `stop` item never means the stop held.
 * - plan: `buildPlanState` at both ends against the same plan; an item only when the position
 *   (or the `no_setup` reason) differs.
 *
 * The result states what could not be read, so a missing item is never mistaken for "nothing
 * happened": `trendMeasured` (false: the trend rule was not measurable at an end),
 * `unevaluatedSignalDays` (sessions whose new-signal question could not be answered) and
 * `skippedCloses` (unusable closes after the baseline, skipped by the level crossings).
 *
 * `bars` must be oldest first with the same price basis as the reference's levels (bars are
 * split-adjusted, a stored level is not; detecting a split in between is the caller's job).
 *
 * @param bars - Daily bars, oldest first.
 * @param options - The baseline bar, the optional reference and an optional signal filter.
 * @returns The changes, or why none can be measured.
 */
export function technicalChangesBetween(
    bars: readonly Bar[],
    options: TechnicalChangesOptions
): TechnicalChangesResult {
    const { fromIndex, reference, signalTypes } = options;
    if (bars.length < MIN_BARS) return { ok: false, reason: 'too_short' };
    const last = bars.length - 1;
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex > last) {
        return { ok: false, reason: 'invalid' };
    }
    if (fromIndex === last) return { ok: false, reason: 'same_session' };
    if (last - fromIndex > TECHNICAL_CHANGES_MAX_SESSIONS) {
        return { ok: false, reason: 'too_old' };
    }
    const from = bars[fromIndex];
    const to = bars[last];
    if (!isFinitePositive(from.close) || !isFinitePositive(to.close)) {
        return { ok: false, reason: 'invalid' };
    }

    const barsFrom = bars.slice(0, fromIndex + 1);
    const indicatorsFrom = calculateIndicators(barsFrom);
    const indicatorsTo = calculateIndicators(bars.slice());
    const plan =
        reference?.plan == null
            ? null
            : planChange(
                  reference.plan,
                  bars,
                  fromIndex,
                  indicatorsFrom,
                  indicatorsTo
              );
    const trend = trendChange(bars, barsFrom, indicatorsFrom, indicatorsTo);
    const signals = signalChanges(bars, fromIndex, signalTypes);
    const changes: TechnicalChange[] = [
        ...(plan === null ? [] : [plan]),
        ...(reference ? levelChanges(bars, fromIndex, reference) : []),
        ...(reference?.plan
            ? planLevelChanges(bars, fromIndex, reference.plan)
            : []),
        ...(trend.change === null ? [] : [trend.change]),
        ...signals.changes,
    ];
    return {
        ok: true,
        fromTime: from.time,
        toTime: to.time,
        closeFrom: from.close,
        closeTo: to.close,
        changes,
        trendMeasured: trend.measured,
        unevaluatedSignalDays: signals.unevaluated,
        skippedCloses: bars
            .slice(fromIndex + 1)
            .filter(bar => !isFinitePositive(bar.close)).length,
    };
}
