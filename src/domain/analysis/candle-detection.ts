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

export const CANDLE_PATTERN_DETECTION_BARS = 15;

/** Extra bars needed before the detection window to detect 3-bar multi-candle patterns at the start */
export const MULTI_CANDLE_PATTERN_BUFFER = 2;

const THREE_BAR_PATTERN_COUNT = 3;
const TWO_BAR_PATTERN_COUNT = 2;

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

const getPatternBarCount = (pattern: MultiCandlePattern): number =>
    THREE_BAR_PATTERNS.has(pattern)
        ? THREE_BAR_PATTERN_COUNT
        : TWO_BAR_PATTERN_COUNT;

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

/** Extracts the last CANDLE_PATTERN_DETECTION_BARS bars. */
export function getDetectionBars(bars: Bar[]): Bar[] {
    return bars.slice(-CANDLE_PATTERN_DETECTION_BARS);
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** Detects candle patterns from the last N bars; multi-candle patterns take priority and exclude involved bars from single results. */
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
    for (let i = 0; i < extendedLength; i++) {
        if (i < detectionStartIndex) continue;
        const candleWindow = extendedBars.slice(Math.max(0, i - 2), i + 1);
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
    ).map(([i, { pattern }]) => ({
        barIndex: i - detectionStartIndex,
        patternType: 'multi' as const, // literal type 추론 보조 — 런타임 값 변경 없음
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
            return [
                {
                    barIndex: i,
                    patternType: 'single' as const, // literal type 추론 보조 — 런타임 값 변경 없음
                    singlePattern: pattern,
                    multiPattern: null,
                },
            ];
        }
    );

    return mergeSortedEntries(singleEntries, multiEntries);
}

// ─── Selection ──────────────────────────────────────────────────────────────

/** Returns last multi-candle + last single-candle entry (if any); ensures both types are represented when co-existing. */
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
