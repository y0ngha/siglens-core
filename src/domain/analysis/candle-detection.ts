import type {
    Bar,
    CandlePatternEntry,
    MultiCandlePattern,
} from '@/domain/types';
import {
    detectCandlePattern,
    detectMultiCandlePattern,
} from '@/domain/analysis/candle';
import { EXCLUDED_SINGLE_PATTERNS } from '@/domain/analysis/candle-trend';

// ─── Constants ───────────────────────────────────────────────────────────────

/** @internal Number of recent bars scanned for candle patterns. */
export const CANDLE_PATTERN_DETECTION_BARS = 15;

/** @internal Extra bars before the detection window so 5-bar multi-candle patterns are detectable at the start. */
export const MULTI_CANDLE_PATTERN_BUFFER = 4;

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

function getPatternBarCount(pattern: MultiCandlePattern): number {
    if (FIVE_BAR_PATTERNS.has(pattern)) return FIVE_BAR_PATTERN_COUNT;
    if (FOUR_BAR_PATTERNS.has(pattern)) return FOUR_BAR_PATTERN_COUNT;
    if (THREE_BAR_PATTERNS.has(pattern)) return THREE_BAR_PATTERN_COUNT;
    return TWO_BAR_PATTERN_COUNT;
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
 * 5-bar multi-candle patterns first (using a small leading buffer so 5-bar
 * patterns can be detected at the start of the window). Bars
 * involved in any multi pattern are excluded from single-pattern detection
 * to prevent overlap. Single-pattern entries in `EXCLUDED_SINGLE_PATTERNS`
 * (the directional / flat / spinning-top noise patterns) are also dropped.
 *
 * Returned entries are merged in chronological `barIndex` order using a
 * two-pointer merge of the multi and single sub-lists.
 *
 * @param bars - Full OHLCV bar series sorted oldest-first; only the trailing
 *   detection window plus a small buffer is examined.
 * @returns Detected pattern entries in ascending `barIndex` order.
 *
 * @see selectLastCandlePatternEntries
 * @see getDetectionBars
 */
export function detectCandlePatternEntries(bars: Bar[]): CandlePatternEntry[] {
    const extendedCount =
        CANDLE_PATTERN_DETECTION_BARS + MULTI_CANDLE_PATTERN_BUFFER;
    const extendedBars = bars.slice(-extendedCount);
    const extendedLength = extendedBars.length;
    const detectionStartIndex = Math.max(
        0,
        extendedLength - CANDLE_PATTERN_DETECTION_BARS
    );

    // Detect multi-candle patterns and collect involved bar indices
    const multiEntryMap = new Map<
        number,
        { pattern: MultiCandlePattern; involvedIndices: number[] }
    >();
    for (let i = detectionStartIndex; i < extendedLength; i++) {
        const candleWindow = extendedBars.slice(
            Math.max(0, i - MULTI_CANDLE_PATTERN_BUFFER),
            i + 1
        );
        const detected = detectMultiCandlePattern(candleWindow);
        if (detected === null) continue;

        const patternBarCount = getPatternBarCount(detected);
        const startIdx = Math.max(0, i - patternBarCount + 1);
        const involvedIndices = Array.from(
            { length: i - startIdx + 1 },
            (__, offset) => startIdx + offset
        );

        multiEntryMap.set(i, { pattern: detected, involvedIndices });
    }

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
    const detectionBars = extendedBars.slice(detectionStartIndex);
    const singleEntries: CandlePatternEntry[] = detectionBars.flatMap(
        (bar, i) => {
            const extendedIndex = i + detectionStartIndex;
            if (multiInvolvedIndices.has(extendedIndex)) return [];
            const pattern = detectCandlePattern(bar);
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

    const lastMultiEntry = entries.findLast(e => e.patternType === 'multi');
    const lastSingleEntry = entries.findLast(e => e.patternType === 'single');

    return [lastMultiEntry, lastSingleEntry]
        .filter((e): e is CandlePatternEntry => e !== undefined)
        .toSorted((a, b) => a.barIndex - b.barIndex);
}
