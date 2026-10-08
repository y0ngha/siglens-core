import type { Bar, PatternCandidate } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { CLASSIFIERS } from '@/domain/patterns/classifiers';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';

/**
 * @internal — not yet re-exported from src/index.ts.
 * The chart-pattern pre-screener facade — the entry point for
 * analysis-submission observation logging and AI skill-doc selection. It
 * never decides what is drawn: `qualifyPatterns` does (spec 2026-10-07), and
 * a hit that does not qualify is only a "shape hint" in the prompt.
 *
 * Recall-biased by design (see {@link CLASSIFIERS} JSDoc): this is a coarse
 * pre-filter choosing which pattern skill docs are worth injecting into an AI
 * prompt, not a final judge. Callers should expect some false positives and
 * treat an empty result as "no plausible pattern currently on the chart",
 * not "definitely no pattern".
 *
 * Pipeline:
 * 1. Slice `bars` down to the last `SCREEN_LOOKBACK_BARS` (or fewer, if
 *    `bars` is shorter — the whole input is used).
 * 2. Extract pivots over that window with `includeProvisional: true`, so
 *    classifiers can see the still-forming extreme at the right edge of the
 *    chart — patterns must be recognizable in what is on the chart *now*.
 * 3. Run every classifier in `CLASSIFIERS` and flatten the results.
 * 4. Dedupe by `id` (first occurrence wins) and sort by
 *    `id.localeCompare(..., 'en')` for a deterministic, order-independent
 *    output regardless of classifier iteration order.
 *
 * **Index rebasing**: classifiers see only the sliced window, so the
 * `startIndex`/`endIndex` they return are indices into that window, not into
 * `bars`. This facade adds back the slice offset before returning, so every
 * `PatternCandidate` downstream consumers (logs, prompts) see references a
 * real position in the original `bars` array the caller passed in.
 *
 * @param bars - OHLCV bars sorted oldest-first. The full available history —
 * this function does its own windowing.
 * @param atr - Average True Range for the same bars (scale reference).
 * @returns Deduped, deterministically sorted pattern candidates; `[]` when
 * `bars` is empty, `atr <= 0`, or no classifier matches.
 */
export function screenChartPatterns(
    bars: readonly Bar[],
    atr: number
): PatternCandidate[] {
    if (bars.length === 0 || atr <= 0) return [];

    const offset = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const windowBars = bars.slice(offset);

    const pivots = extractPivots(windowBars, atr, { includeProvisional: true });
    const raw = CLASSIFIERS.flatMap(classify =>
        classify(pivots, windowBars, atr)
    );

    const byId = new Map<string, PatternCandidate>();
    for (const candidate of raw) {
        // Defensive: no current classifier pair emits the same pattern id, so
        // this first-wins branch is not exercised today. Kept because
        // `CLASSIFIERS` is expected to grow over time, and a future pair
        // overlapping on the same id should degrade to "keep the first hit"
        // rather than silently overwrite it.
        if (byId.has(candidate.id)) continue;
        byId.set(candidate.id, {
            id: candidate.id,
            startIndex: candidate.startIndex + offset,
            endIndex: candidate.endIndex + offset,
            // Rebase each matched pivot's index the same way, so `pivots`
            // (part of the public `PatternCandidate`) point into the caller's
            // `bars` like `startIndex`/`endIndex` do.
            ...(candidate.pivots
                ? {
                      pivots: candidate.pivots.map(p => ({
                          ...p,
                          index: p.index + offset,
                      })),
                  }
                : {}),
        });
    }

    return [...byId.values()].toSorted((a, b) =>
        a.id.localeCompare(b.id, 'en')
    );
}
