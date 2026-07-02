import type { Bar } from '@/domain/types';
import type { PatternCandidate } from '@/domain/patterns/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { CLASSIFIERS } from '@/domain/patterns/classifiers';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';

/**
 * The chart-pattern pre-screener facade — the single public entry point for
 * Task 1.5 (analysis-submission logging) and, later, Phase 3 (AI skill-doc
 * selection).
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
    const window = bars.slice(offset);

    const pivots = extractPivots(window, atr, { includeProvisional: true });
    const raw = CLASSIFIERS.flatMap(classify => classify(pivots, window, atr));

    const byId = new Map<string, PatternCandidate>();
    for (const candidate of raw) {
        if (byId.has(candidate.id)) continue;
        byId.set(candidate.id, {
            id: candidate.id,
            startIndex: candidate.startIndex + offset,
            endIndex: candidate.endIndex + offset,
        });
    }

    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
