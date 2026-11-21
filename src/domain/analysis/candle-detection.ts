import type {
    Bar,
    CandlePattern,
    CandlePatternEntry,
    CandlePriorMove,
    MultiCandlePattern,
} from '@/domain/types';
import {
    detectCandlePattern,
    detectMultiCandlePattern,
} from '@/domain/analysis/candle';
import {
    CANDLE_PRIOR_TREND_BARS,
    candlePriorMove,
} from '@/domain/analysis/candle-context';
import { calculateATR } from '@/domain/indicators/atr';
import { EXCLUDED_SINGLE_PATTERNS } from '@/domain/analysis/candle-trend';
import { findLast } from '@/domain/arrayCompat';

// ─── Constants ───────────────────────────────────────────────────────────────

/** @internal Number of recent bars scanned for candle patterns. */
export const CANDLE_PATTERN_DETECTION_BARS = 15;

/** @internal Bars before the last bar of the longest (5-bar) multi-candle pattern. */
export const MULTI_CANDLE_PATTERN_BUFFER = 4;

/**
 * Trailing bars handed to the multi-pattern detector per scanned bar: the
 * pattern ({@link MULTI_CANDLE_PATTERN_BUFFER} + 1 bars), the bar before it
 * (where its prior move ends) and the {@link CANDLE_PRIOR_TREND_BARS} bars
 * the move spans.
 */
const MULTI_PATTERN_WINDOW_BARS =
    MULTI_CANDLE_PATTERN_BUFFER + 1 + 1 + CANDLE_PRIOR_TREND_BARS;

/** Single patterns named by the move before them; every other single is shape-only. */
const CONTEXT_GATED_SINGLE_PATTERNS: ReadonlySet<CandlePattern> = new Set([
    'hammer',
    'hanging_man',
    'inverted_hammer',
    'shooting_star',
    'dragonfly_doji',
    'gravestone_doji',
    'bullish_belt_hold',
    'bearish_belt_hold',
]);

const FIVE_BAR_PATTERN_COUNT = 5;
const FOUR_BAR_PATTERN_COUNT = 4;
const THREE_BAR_PATTERN_COUNT = 3;
const TWO_BAR_PATTERN_COUNT = 2;

/** 5-bar multi-candle patterns */
const FIVE_BAR_PATTERNS: ReadonlySet<MultiCandlePattern> = new Set([
    'rising_three_methods',
    'falling_three_methods',
]);

/** 4-bar multi-candle patterns */
const FOUR_BAR_PATTERNS: ReadonlySet<MultiCandlePattern> = new Set([
    'bullish_three_line_strike',
    'bearish_three_line_strike',
]);

/** 3-bar multi-candle patterns */
const THREE_BAR_PATTERNS: ReadonlySet<MultiCandlePattern> = new Set([
    'morning_star',
    'morning_doji_star',
    'evening_star',
    'evening_doji_star',
    'bullish_abandoned_baby',
    'bearish_abandoned_baby',
    'three_white_soldiers',
    'three_black_crows',
    'three_inside_up',
    'three_inside_down',
    'three_outside_up',
    'three_outside_down',
    'bullish_triple_star',
    'bearish_triple_star',
    'upside_gap_two_crows',
    'downside_gap_two_rabbits',
    'advance_block',
    'upside_gap_tasuki',
    'downside_gap_tasuki',
    'ladder_bottom',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * @internal Bars a multi-bar pattern spans. Kept beside the detector in a test
 * that runs every pattern through the real detector, so the suppression span
 * and the basis clause cannot drift from the length the gate used.
 */
export function getPatternBarCount(pattern: MultiCandlePattern): number {
    if (FIVE_BAR_PATTERNS.has(pattern)) return FIVE_BAR_PATTERN_COUNT;
    if (FOUR_BAR_PATTERNS.has(pattern)) return FOUR_BAR_PATTERN_COUNT;
    if (THREE_BAR_PATTERNS.has(pattern)) return THREE_BAR_PATTERN_COUNT;
    return TWO_BAR_PATTERN_COUNT;
}

/**
 * @internal The caller's ATR when aligned with `bars`, otherwise ATR(14) of
 * `bars`. The one rule every candle consumer (detection, prompt rows and
 * basis clauses) uses, so they read the same series.
 */
export function resolveCandleAtr(
    bars: readonly Bar[],
    atr: readonly (number | null)[] | undefined
): readonly (number | null)[] {
    return atr !== undefined && atr.length === bars.length
        ? atr
        : calculateATR(bars);
}

/** Yield merged entries from two sorted arrays in O(n) using two-pointer. */
function* mergeSortedGen(
    a: CandlePatternEntry[],
    b: CandlePatternEntry[]
): Generator<CandlePatternEntry> {
    let ai = 0;
    let bi = 0;
    while (ai < a.length && bi < b.length) {
        if (a[ai].barIndex <= b[bi].barIndex) yield a[ai++];
        else yield b[bi++];
    }
    while (ai < a.length) yield a[ai++];
    while (bi < b.length) yield b[bi++];
}

/** Merge two sorted CandlePatternEntry arrays into one sorted array in O(n) using two-pointer. */
function mergeSortedEntries(
    a: CandlePatternEntry[],
    b: CandlePatternEntry[]
): CandlePatternEntry[] {
    return [...mergeSortedGen(a, b)];
}

/**
 * Slice the most recent `CANDLE_PATTERN_DETECTION_BARS` bars from a series.
 *
 * Helper used by both pattern detection and downstream rendering to
 * reference the same fixed-size detection window — keeps `barIndex`
 * values consistent across modules.
 *
 * @param bars - Full OHLCV bar series sorted oldest-first.
 * @returns The trailing detection window (or the full array if shorter).
 *
 * @see detectCandlePatternEntries
 */
export function getDetectionBars(bars: Bar[]): Bar[] {
    return bars.slice(-CANDLE_PATTERN_DETECTION_BARS);
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect every candle pattern within the trailing detection window.
 *
 * For each bar in the last `CANDLE_PATTERN_DETECTION_BARS`, evaluates 2- to
 * 5-bar multi-candle patterns first. Bars involved in any multi pattern are
 * excluded from single-pattern detection to prevent overlap; a multi pattern
 * that fails its context rule is not a detection, so it suppresses nothing.
 * Single-pattern entries in `EXCLUDED_SINGLE_PATTERNS` (the directional / flat
 * / spinning-top noise patterns) are also dropped.
 *
 * Patterns are context-aware: hammer / hanging man and inverted hammer /
 * shooting star are named by the 10-bar move before the bar (at least 1 ATR,
 * not by body colour); a dragonfly or gravestone doji and a belt-hold need
 * that move; every multi pattern needs the move its definition requires, a
 * first-bar body of at least 0.25 ATR (two- and three-bar reversals), and
 * tweezers need a confirming close (see `detectMultiCandlePattern`). Reading
 * the move needs at least 15 bars before a pattern's first bar (the ATR(14)
 * warm-up); a pattern with fewer bars before it is not detected. Shape-only
 * patterns (marubozu, doji, spinning top) are unaffected.
 *
 * Returned entries are merged in chronological `barIndex` order using a
 * two-pointer merge of the multi and single sub-lists. `barIndex` counts from
 * the start of the trailing detection window.
 *
 * @param bars - Full OHLCV bar series sorted oldest-first. Only the trailing
 *   detection window is scanned, but earlier bars supply each pattern's prior
 *   move.
 * @param options - Optional. `atr`: the ATR(14) series aligned with `bars`
 *   (e.g. `IndicatorResult.atr`). Used only when it has `bars.length`
 *   elements; otherwise the ATR is calculated from `bars`.
 * @returns Detected pattern entries in ascending `barIndex` order.
 *
 * @see selectLastCandlePatternEntries
 * @see getDetectionBars
 */
export function detectCandlePatternEntries(
    bars: Bar[],
    options?: { atr?: readonly (number | null)[] }
): CandlePatternEntry[] {
    const atr = resolveCandleAtr(bars, options?.atr);
    const detectionStartIndex = Math.max(
        0,
        bars.length - CANDLE_PATTERN_DETECTION_BARS
    );

    // Detect multi-candle patterns and collect involved bar indices
    const multiEntryMap = new Map(
        Array.from(
            { length: bars.length - detectionStartIndex },
            (__, offset) => detectionStartIndex + offset
        ).flatMap(i => {
            const windowStart = Math.max(0, i + 1 - MULTI_PATTERN_WINDOW_BARS);
            const detected = detectMultiCandlePattern(
                bars.slice(windowStart, i + 1),
                atr.slice(windowStart, i + 1)
            );
            if (detected === null) return [];

            const startIdx = Math.max(0, i - getPatternBarCount(detected) + 1);
            const involvedIndices = Array.from(
                { length: i - startIdx + 1 },
                (___, offset) => startIdx + offset
            );
            return [[i, { pattern: detected, involvedIndices }] as const];
        })
    );

    // Collect all bar indices involved in any multi-candle pattern
    const multiInvolvedIndices = new Set(
        Array.from(multiEntryMap.values()).flatMap(
            ({ involvedIndices }) => involvedIndices
        )
    );

    // Build multi entries (only for bars in detection window)
    const multiEntries: CandlePatternEntry[] = Array.from(
        multiEntryMap.entries()
    ).map(([i, { pattern }]): CandlePatternEntry => ({
        barIndex: i - detectionStartIndex,
        patternType: 'multi',
        singlePattern: null,
        multiPattern: pattern,
    }));

    // Build single entries (excluding bars involved in multi patterns)
    const detectionBars = bars.slice(detectionStartIndex);
    const singleEntries: CandlePatternEntry[] = detectionBars.flatMap(
        (bar, i) => {
            const index = i + detectionStartIndex;
            if (multiInvolvedIndices.has(index)) return [];
            const pattern = detectCandlePattern(
                bar,
                candlePriorMove(bars, index, atr).trend
            );
            if (EXCLUDED_SINGLE_PATTERNS.has(pattern)) return [];
            const entry: CandlePatternEntry = {
                barIndex: i,
                patternType: 'single',
                singlePattern: pattern,
                multiPattern: null,
            };
            return [entry];
        }
    );

    return mergeSortedEntries(singleEntries, multiEntries);
}

/**
 * The prior move a context-gated entry rests on, for the prompt's basis clause.
 *
 * `null` for a shape-only entry (marubozu, plain doji): nothing to explain.
 * Otherwise the move before the entry's FIRST bar, read from the same `bars`
 * and ATR as {@link detectCandlePatternEntries} (`atr` is resolved the same
 * way).
 *
 * @internal
 * @param bars - The same bar series the entry was detected on.
 * @param entry - An entry returned for `bars`.
 * @param atr - The `options.atr` given to the detection, if any.
 */
export function candleEntryPriorMove(
    bars: readonly Bar[],
    entry: CandlePatternEntry,
    atr?: readonly (number | null)[]
): CandlePriorMove | null {
    if (
        entry.patternType === 'single' &&
        !CONTEXT_GATED_SINGLE_PATTERNS.has(entry.singlePattern)
    )
        return null;

    const lastIndex =
        Math.max(0, bars.length - CANDLE_PATTERN_DETECTION_BARS) +
        entry.barIndex;
    const firstIndex =
        entry.patternType === 'multi'
            ? lastIndex - getPatternBarCount(entry.multiPattern) + 1
            : lastIndex;
    return candlePriorMove(bars, firstIndex, resolveCandleAtr(bars, atr));
}

// ─── Selection ──────────────────────────────────────────────────────────────

/**
 * Pick the latest multi-bar and single-bar pattern entries from the full set.
 *
 * Returns at most two entries — the most recent multi pattern (if any) and
 * the most recent single pattern (if any) — sorted by `barIndex`. This
 * keeps prompt rendering and chart annotation focused on the freshest
 * actionable formation in each category instead of cluttering the output
 * with every detected entry.
 *
 * @param entries - The full result of {@link detectCandlePatternEntries}.
 * @returns Up to two entries (most recent multi + most recent single) in
 *   ascending `barIndex` order; empty when `entries` is empty.
 *
 * @see detectCandlePatternEntries
 */
export function selectLastCandlePatternEntries(
    entries: CandlePatternEntry[]
): CandlePatternEntry[] {
    if (entries.length === 0) return [];

    const lastMultiEntry = findLast(entries, e => e.patternType === 'multi');
    const lastSingleEntry = findLast(entries, e => e.patternType === 'single');

    return [lastMultiEntry, lastSingleEntry]
        .filter((e): e is CandlePatternEntry => e !== undefined)
        .sort((a, b) => a.barIndex - b.barIndex);
}
