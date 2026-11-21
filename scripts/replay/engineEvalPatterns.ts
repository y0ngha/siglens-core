/**
 * Chart-pattern half of the engine evaluation: the walk-forward detection pass, the
 * deterministic violation counters (G1) and the level-transplant placebo. Pure: bars in,
 * events and counters out.
 *
 * The counters recompute breaks, frozen levels and pivot proofs from OHLC and the lines a
 * pattern carries. They never read a `breakoutIndex` the pattern may or may not have, so the
 * same code judges an arm before and after the freeze exists.
 *
 * Script exception: `patternWalkForSymbol` is one `for` loop with `push` because state is
 * tracked across steps in a single pass (CONVENTIONS.md#CP-5).
 */
import { isFailedBreakout } from '@/domain/analysis/chartPatternCandidatesSection';
import { calculateATR } from '@/domain/indicators/atr';
import { labelPatternOutcome } from '@/domain/outcomes/labelPatternOutcome';
import {
    OUTCOME_PRE_BARS,
    OUTCOME_WINDOW_BARS,
} from '@/domain/outcomes/constants';
import type { OutcomeBarTuple, OutcomeWindow } from '@/domain/outcomes/types';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import {
    PIVOT_REVERSAL_ATR_MULT,
    SCREEN_LOOKBACK_BARS,
} from '@/domain/patterns/constants';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { extractPivots } from '@/domain/patterns/pivots';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import type {
    Bar,
    FlagPatternShape,
    PatternGeometry,
    PatternLine,
    QualifiedPattern,
    QualifiedPatternGeometry,
    TrendlinePatternShape,
} from '@/domain/types';
import { eligiblePlaceboDates, measurable } from './engineEvalCandles';
import {
    halfOf,
    isoDate,
    isoWeekKey,
    sampleWithoutReplacement,
    streamForKey,
} from './engineEvalStats';
import {
    CORE_DERIVED,
    EVAL_CONSTANTS,
    type EvalMarket,
    type PatternBucket,
    type PatternEvent,
    type PatternLabel,
    type PatternMetric,
    type PatternOutcomeKind,
} from './engineEvalTypes';
import { mean } from './stats';

const {
    patternForwardBars,
    patternPriorTrendBars,
    patternPriorTrendMinAtr,
    placeboCount,
    minPlacebo,
    seed,
    levelTolerance,
} = EVAL_CONSTANTS;

/** Counters keyed `metric` and `metric:<pattern id>`, e.g. `wrongSideDays:bull_flag`. */
export type PatternCounters = Record<string, number>;

const sameLevel = (a: number, b: number): boolean =>
    Math.abs(a - b) <= levelTolerance * Math.max(1, Math.abs(a), Math.abs(b));

// ─── Buckets, outcomes, placebo levels ────────────────────────────────────────

/** Prior-trend bucket of the chart-pattern rule (20 bars, 2 ATR) read at bar `t`. */
export function patternBucket(
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    t: number
): PatternBucket {
    const scale = atr[t];
    if (scale === null || scale === undefined || !(scale > 0)) return 'none';
    const change =
        bars[t].close - bars[Math.max(0, t - patternPriorTrendBars)].close;
    if (Math.abs(change) < patternPriorTrendMinAtr * scale) return 'none';
    return change > 0 ? 'up' : 'down';
}

/**
 * The race after bar `t`: within `patternForwardBars` bars, the first bar that reaches the
 * level (high for up, low for down) or closes beyond the invalidation. A bar doing both
 * counts against the pattern. `open` when neither happens.
 */
export function forwardOutcome(
    bars: readonly Bar[],
    t: number,
    up: boolean,
    level: number,
    invalidation: number
): PatternOutcomeKind {
    const verdicts = Array.from({ length: patternForwardBars }, (_, k) => {
        const bar = bars[t + 1 + k];
        const hit = up ? bar.high >= level : bar.low <= level;
        const dead = up ? bar.close < invalidation : bar.close > invalidation;
        if (dead) return 'inval' as const;
        return hit ? ('hit' as const) : null;
    });
    return verdicts.find(v => v !== null) ?? 'open';
}

/**
 * The event's level moved to a placebo date: its distance from the event close, in event
 * ATR%, becomes the same distance in the placebo date's ATR%.
 */
export function transplantLevel(
    level: number,
    eventClose: number,
    eventAtrPct: number,
    placeboClose: number,
    placeboAtrPct: number
): number {
    return (
        placeboClose *
        (1 +
            ((level - eventClose) / eventClose) * (placeboAtrPct / eventAtrPct))
    );
}

// ─── Per-day counters ─────────────────────────────────────────────────────────

export interface DayFlags {
    directed: boolean;
    /** Directed: the breakout is not on the pattern's side of the invalidation. */
    wrongSide: boolean;
    /** A printed level or target is not a positive number. */
    nonPositive: boolean;
    /** A close beyond the breakout line has already happened before the last bar. */
    postBreak: boolean;
    /** Post-break, and a printed level differs from the line at the break bar. */
    moving: boolean;
    /** Last close beyond the printed level / beyond the recomputed frozen level. */
    printedBroken: boolean | null;
    frozenBroken: boolean | null;
    /**
     * `isFailedBreakout` disagrees with the same test run on the level frozen at the
     * recomputed break bar; `null` for a family with no boundary lines.
     */
    failedDisagree: boolean | null;
}

type LinePattern = QualifiedPattern & {
    shape: TrendlinePatternShape | FlagPatternShape;
};

const isLinePattern = (pattern: QualifiedPattern): pattern is LinePattern =>
    pattern.shape.kind === 'trendline' || pattern.shape.kind === 'flag';

const NO_LINE_FLAGS = {
    postBreak: false,
    moving: false,
    printedBroken: null,
    frozenBroken: null,
    failedDisagree: null,
} as const;

/** First bar after the pattern's end for which `beyond` holds, or `undefined`. */
function firstBreak(
    from: number,
    last: number,
    beyond: (i: number) => boolean
): number | undefined {
    return Array.from(
        { length: Math.max(0, last - from + 1) },
        (_, k) => from + k
    ).find(beyond);
}

/**
 * `isFailedBreakout` on the level frozen at `breakIndex`: the side's line becomes a flat
 * line at its value there, and the closes between the line's last touch and the break are
 * shifted so their offset from the flat level equals their offset from the real line
 * (before the break the frozen level IS the line).
 */
function frozenFailedBreakout(
    pattern: LinePattern,
    bars: readonly Bar[],
    atr: number,
    side: 'up' | 'down',
    breakIndex: number
): boolean {
    const line = side === 'up' ? pattern.shape.upper : pattern.shape.lower;
    const level = lineValueAt(line, breakIndex);
    const flat: PatternLine = {
        start: { index: line.end.index, price: level },
        end: { index: line.end.index, price: level },
        touches: line.touches,
    };
    const shifted = bars.map((bar, i) =>
        i > line.end.index && i < breakIndex
            ? { ...bar, close: bar.close - lineValueAt(line, i) + level }
            : bar
    );
    const shape = {
        ...pattern.shape,
        upper: side === 'up' ? flat : pattern.shape.upper,
        lower: side === 'down' ? flat : pattern.shape.lower,
    };
    return isFailedBreakout(
        { ...pattern, shape },
        { direction: side, breakoutLevel: level },
        shifted,
        atr
    );
}

function lineFlags(
    pattern: LinePattern,
    geometry: QualifiedPatternGeometry,
    bars: readonly Bar[],
    atr: number
): Pick<
    DayFlags,
    'postBreak' | 'moving' | 'printedBroken' | 'frozenBroken' | 'failedDisagree'
> {
    const last = bars.length - 1;
    const from = pattern.endIndex + 1;
    const close = bars[last].close;
    const { upper, lower } = pattern.shape;
    const engine = isFailedBreakout(pattern, geometry, bars, atr);
    if (geometry.direction === null) {
        const broke = firstBreak(
            from,
            last,
            i =>
                bars[i].close > lineValueAt(upper, i) ||
                bars[i].close < lineValueAt(lower, i)
        );
        const at = broke ?? last;
        const frozenUpper = lineValueAt(upper, at);
        const frozenLower = lineValueAt(lower, at);
        const postBreak = broke !== undefined && broke < last;
        return {
            postBreak,
            moving:
                postBreak &&
                !(
                    sameLevel(geometry.upperLevel, frozenUpper) &&
                    sameLevel(geometry.lowerLevel, frozenLower)
                ),
            printedBroken:
                close > geometry.upperLevel || close < geometry.lowerLevel,
            frozenBroken: close > frozenUpper || close < frozenLower,
            failedDisagree:
                broke !== undefined &&
                engine !==
                    (frozenFailedBreakout(pattern, bars, atr, 'up', broke) ||
                        frozenFailedBreakout(
                            pattern,
                            bars,
                            atr,
                            'down',
                            broke
                        )),
        };
    }
    const sign = geometry.direction === 'up' ? 1 : -1;
    const line = geometry.direction === 'up' ? upper : lower;
    const broke = firstBreak(
        from,
        last,
        i => sign * (bars[i].close - lineValueAt(line, i)) > 0
    );
    const frozen = lineValueAt(line, broke ?? last);
    const postBreak = broke !== undefined && broke < last;
    return {
        postBreak,
        moving: postBreak && !sameLevel(geometry.breakoutLevel, frozen),
        printedBroken: sign * (close - geometry.breakoutLevel) > 0,
        frozenBroken: sign * (close - frozen) > 0,
        failedDisagree:
            broke !== undefined &&
            engine !==
                frozenFailedBreakout(
                    pattern,
                    bars,
                    atr,
                    geometry.direction,
                    broke
                ),
    };
}

/** The G1 flags of one qualified pattern on one day, recomputed from OHLC. */
export function dayFlags(
    pattern: QualifiedPattern,
    geometry: QualifiedPatternGeometry,
    bars: readonly Bar[],
    atr: number
): DayFlags {
    const reading = isLinePattern(pattern)
        ? lineFlags(pattern, geometry, bars, atr)
        : NO_LINE_FLAGS;
    if (geometry.direction === null) {
        return {
            directed: false,
            wrongSide: false,
            nonPositive: !(geometry.upperLevel > 0 && geometry.lowerLevel > 0),
            ...reading,
        };
    }
    const wrongSide =
        geometry.direction === 'up'
            ? geometry.breakoutLevel <= geometry.invalidationLevel
            : geometry.breakoutLevel >= geometry.invalidationLevel;
    return {
        directed: true,
        wrongSide,
        nonPositive: !(
            geometry.breakoutLevel > 0 &&
            geometry.measuredTarget > 0 &&
            geometry.conservativeTarget > 0
        ),
        ...reading,
    };
}

// ─── Pivots ───────────────────────────────────────────────────────────────────

/**
 * The ATR series `extractPivots` reads: a bar without a usable reading carries the last
 * usable one forward, and bars before the first usable reading borrow it. Mirrors the
 * engine's internal `effectiveAtrSeries` (not exported), so the proof check below measures a
 * reversal against the same threshold the engine used. One loop because each value depends on
 * the previous one (CONVENTIONS.md#CP-5).
 */
export function effectiveAtr(
    atr: readonly (number | null)[]
): (number | null)[] {
    const usable = (v: number | null | undefined): v is number =>
        v !== null && v !== undefined && Number.isFinite(v) && v > 0;
    const first = atr.find(usable) ?? null;
    const out: (number | null)[] = [];
    for (let i = 0; i < atr.length; i++) {
        const value = atr[i];
        out.push(usable(value) ? value : (out[i - 1] ?? first));
    }
    return out;
}

export interface PivotCounts {
    pivots: number;
    /** Pivots the prefix ending at their own bar already lists. */
    selfConfirmed: number;
    /** Of those, the ones whose close alone does not prove the reversal. */
    selfNotCloseProven: number;
}

/**
 * Over the whole history: how many chart-pattern pivots are confirmed by their own bar
 * (the prefix that ends at the pivot bar already lists it, independent of the engine's
 * internal state) and how many of those the close does not prove (the gap between the
 * extreme and the close is below the reversal threshold, measured in the engine's
 * effective ATR).
 */
export function pivotCounts(
    bars: readonly Bar[],
    atr: readonly (number | null)[]
): PivotCounts {
    const pivots = extractPivots([...bars], atr, { onePivotPerBar: true });
    const effective = effectiveAtr(atr);
    const flags = pivots.map(pivot => {
        const prefix = extractPivots(
            bars.slice(0, pivot.index + 1),
            atr.slice(0, pivot.index + 1),
            { onePivotPerBar: true }
        );
        const self = prefix.some(
            q => q.index === pivot.index && q.kind === pivot.kind
        );
        const bar = bars[pivot.index];
        const scale = effective[pivot.index];
        const proven =
            scale !== null &&
            (pivot.kind === 'high'
                ? bar.high - bar.close
                : bar.close - bar.low) >=
                PIVOT_REVERSAL_ATR_MULT * scale;
        return { self, notProven: self && !proven };
    });
    return {
        pivots: pivots.length,
        selfConfirmed: flags.filter(f => f.self).length,
        selfNotCloseProven: flags.filter(f => f.notProven).length,
    };
}

export interface RepaintCounts {
    checks: number;
    repaints: number;
}

interface PivotRecord {
    kind: string;
    price: number;
}

/**
 * Pivots a window reports, keyed by absolute bar index. Compared across consecutive windows:
 * a pivot of the previous window that is still inside the lookback of this one must be
 * unchanged (same kind and price).
 */
export function repaintCounts(
    previous: ReadonlyMap<number, PivotRecord> | null,
    current: ReadonlyMap<number, PivotRecord>,
    lookbackStart: number
): RepaintCounts {
    if (previous === null) return { checks: 0, repaints: 0 };
    const checked = [...previous].filter(([index]) => index >= lookbackStart);
    const repainted = checked.filter(([index, before]) => {
        const now = current.get(index);
        return (
            now === undefined ||
            now.kind !== before.kind ||
            now.price !== before.price
        );
    });
    return { checks: checked.length, repaints: repainted.length };
}

// ─── Events ───────────────────────────────────────────────────────────────────

type DirectedGeometry = PatternGeometry;

interface EventInput {
    symbol: string;
    market: EvalMarket;
    bars: readonly Bar[];
    atr: readonly (number | null)[];
    t: number;
    id: string;
    /** Time of the pattern's first structural bar: part of the instance key and placebo seed. */
    startTime: number;
    geometry: DirectedGeometry;
}

const barTuple = (bar: Bar): OutcomeBarTuple => [
    bar.time,
    bar.open,
    bar.high,
    bar.low,
    bar.close,
];

/** WP-06 `labelPatternOutcome` on the instance, 20 bars ahead, basis unscaled. */
function labelOf(
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    t: number,
    id: string,
    geometry: DirectedGeometry
): PatternLabel {
    const window: OutcomeWindow = {
        referencePrice: bars[t].close,
        adjFactor: 1,
        anchorForming: false,
        anchorSource: 'prompt_bar',
        atr: atr[t] ?? null,
        preCloses: bars
            .slice(Math.max(0, t - OUTCOME_PRE_BARS + 1), t + 1)
            .map(bar => bar.close),
        anchorBar: barTuple(bars[t]),
        forward: bars.slice(t + 1, t + 1 + OUTCOME_WINDOW_BARS).map(barTuple),
    };
    const sign = geometry.direction === 'up' ? 1 : -1;
    const label = labelPatternOutcome(
        {
            name: id,
            candidateId: id,
            direction: geometry.direction,
            breakout: geometry.breakoutLevel,
            extreme: geometry.breakoutLevel - sign * geometry.height,
            invalidation: geometry.invalidationLevel,
        },
        window,
        1
    );
    return {
        outcome: label.outcome,
        skipReason: label.skipReason,
        rwNullTargetFirst: label.rwNullTargetFirst,
    };
}

/** The first-appearance event with its placebo; `null` when too few placebo dates exist. */
export function patternEventFor(input: EventInput): PatternEvent | null {
    const { symbol, market, bars, atr, t, id, startTime, geometry } = input;
    const up = geometry.direction === 'up';
    const bucket = patternBucket(bars, atr, t);
    const close = bars[t].close;
    const atrPct = (atr[t] ?? Number.NaN) / close;
    const dates = sampleWithoutReplacement(
        eligiblePlaceboDates(
            atr,
            bars.length,
            t,
            patternForwardBars,
            candidate => patternBucket(bars, atr, candidate) === bucket
        ),
        placeboCount,
        streamForKey(seed, `${symbol}|${t}|${id}|${startTime}|pattern`)
    );
    if (dates.length < minPlacebo) return null;
    const placebo = dates.map(date => {
        const move = (level: number): number =>
            transplantLevel(
                level,
                close,
                atrPct,
                bars[date].close,
                (atr[date] ?? Number.NaN) / bars[date].close
            );
        const inval = move(geometry.invalidationLevel);
        const hit = (level: number): number =>
            forwardOutcome(bars, date, up, move(level), inval) === 'hit'
                ? 1
                : 0;
        return {
            target: hit(geometry.measuredTarget),
            cons: hit(geometry.conservativeTarget),
        };
    });
    const time = bars[t].time;
    return {
        kind: 'pattern',
        symbol,
        market,
        index: t,
        date: isoDate(time),
        week: isoWeekKey(time),
        half: halfOf(time),
        id,
        direction: geometry.direction,
        bucket,
        close,
        breakout: geometry.breakoutLevel,
        target: geometry.measuredTarget,
        conservativeTarget: geometry.conservativeTarget,
        invalidation: geometry.invalidationLevel,
        target60: forwardOutcome(
            bars,
            t,
            up,
            geometry.measuredTarget,
            geometry.invalidationLevel
        ),
        cons60: forwardOutcome(
            bars,
            t,
            up,
            geometry.conservativeTarget,
            geometry.invalidationLevel
        ),
        placeboTargetHit: mean(placebo.map(p => p.target)) ?? Number.NaN,
        placeboConsHit: mean(placebo.map(p => p.cons)) ?? Number.NaN,
        placeboN: dates.length,
        label20: labelOf(bars, atr, t, id, geometry),
    };
}

// ─── The walk-forward ─────────────────────────────────────────────────────────

const lastNonNull = (values: readonly (number | null)[]): number | null =>
    values.findLast(v => v !== null) ?? null;

interface InstanceDay {
    t: number;
    printedBroken: boolean;
    frozenBroken: boolean;
}

/**
 * The walk-forward over one symbol: a production-size window ending at every bar from the
 * window length on, `screenChartPatterns` then `qualifyPatterns` then geometry, exactly as
 * the prompt path does. The first appearance of every directed (symbol, id, start bar)
 * instance with `patternForwardBars` bars ahead becomes an event with its level-transplant
 * placebo. Counters carry the G1 numbers.
 */
export function patternWalkForSymbol(
    symbol: string,
    market: EvalMarket,
    bars: readonly Bar[]
): { events: PatternEvent[]; counters: PatternCounters } {
    const windowBars = CORE_DERIVED.windowBars;
    const counters: PatternCounters = {};
    const add = (key: string, by: number): void => {
        counters[key] = (counters[key] ?? 0) + by;
    };
    const bump = (metric: PatternMetric, by = 1): void => add(metric, by);
    const fullAtr = calculateATR([...bars]);
    const seen = new Set<string>();
    const lastDay = new Map<string, InstanceDay>();
    const previous: { pivots: ReadonlyMap<number, PivotRecord> | null } = {
        pivots: null,
    };
    const events: PatternEvent[] = [];

    for (let t = windowBars; t < bars.length; t++) {
        const offset = t - windowBars + 1;
        const window = bars.slice(offset, t + 1);
        const atrSeries = calculateATR(window);
        const atr = lastNonNull(atrSeries);
        if (atr === null || !(atr > 0)) continue;
        bump('days');
        const lookbackStart = window.length - SCREEN_LOOKBACK_BARS;
        const pivotMap = new Map(
            extractPivots(window, atrSeries, { onePivotPerBar: true })
                .filter(p => p.index >= lookbackStart)
                .map((p): [number, PivotRecord] => [
                    p.index + offset,
                    { kind: p.kind, price: p.price },
                ])
        );
        const repaint = repaintCounts(
            previous.pivots,
            pivotMap,
            offset + lookbackStart
        );
        bump('pivotRepaintChecks', repaint.checks);
        bump('pivotRepaints', repaint.repaints);
        previous.pivots = pivotMap;

        const { qualified } = qualifyPatterns(
            screenChartPatterns(window, atr, atrSeries),
            window,
            atr,
            '1Day',
            atrSeries
        );
        for (const pattern of qualified) {
            const geometry = computeCandidateGeometry(pattern, window, atr);
            if (geometry === null) continue;
            const flags = dayFlags(pattern, geometry, window, atr);
            const startTime = window[pattern.startIndex].time;
            const key = `${symbol}|${pattern.id}|${startTime}`;
            const count = (metric: PatternMetric, by = 1): void => {
                add(metric, by);
                add(`${metric}:${pattern.id}`, by);
            };
            count('candidateDays');
            count(flags.directed ? 'directedDays' : 'undirectedDays');
            if (flags.wrongSide) count('wrongSideDays');
            if (flags.nonPositive) count('nonPositiveDays');
            if (flags.postBreak) count('postBreakDays');
            if (flags.moving) count('movingPostBreakDays');
            if (flags.failedDisagree === true)
                count('failedBreakoutDisagreeDays');
            const before = lastDay.get(key);
            if (
                before !== undefined &&
                before.t === t - 1 &&
                flags.printedBroken !== null &&
                flags.frozenBroken !== null
            ) {
                count('statusPairs');
                const flipped = before.printedBroken !== flags.printedBroken;
                if (flipped) count('statusFlips');
                if (flipped && before.frozenBroken === flags.frozenBroken)
                    count('unexplainedStatusFlips');
            }
            if (flags.printedBroken !== null && flags.frozenBroken !== null) {
                lastDay.set(key, {
                    t,
                    printedBroken: flags.printedBroken,
                    frozenBroken: flags.frozenBroken,
                });
            }
            if (seen.has(key)) continue;
            seen.add(key);
            count('instances');
            if (geometry.direction === null) continue;
            if (!measurable(fullAtr, bars.length, t, patternForwardBars)) {
                bump('noForwardWindow');
                continue;
            }
            const event = patternEventFor({
                symbol,
                market,
                bars,
                atr: fullAtr,
                t,
                id: pattern.id,
                startTime,
                geometry,
            });
            if (event === null) bump('noPlacebo');
            else events.push(event);
        }
    }
    const pivots = pivotCounts(bars, fullAtr);
    bump('pivots', pivots.pivots);
    bump('selfConfirmedPivots', pivots.selfConfirmed);
    bump('selfConfirmedNotCloseProvenPivots', pivots.selfNotCloseProven);
    return { events, counters };
}
