import type { Bar, PatternCandidate } from '@/domain/types';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { PATTERN_SPENT_SLACK_ATR } from '@/domain/patterns/constants';

/**
 * @internal
 * A screened pattern the price has already moved past: from the pattern's
 * last bar on, a close went beyond its invalidation level (the pattern
 * failed), or after it a bar reached its measured target (the move is done)
 * — each with PATTERN_SPENT_SLACK_ATR of slack. Such a hit describes the
 * past, so it is neither offered to the model nor drawn (2026-10-02: 1.4% of
 * real-data hits had already failed, 1.4% had already hit their target).
 * A hit without geometry is kept — its prompt block already says so.
 */
export function isSpentPattern(
    candidate: PatternCandidate,
    bars: readonly Bar[],
    atr: number
): boolean {
    const g = computeCandidateGeometry(candidate, bars, atr);
    if (g === null) return false;
    const slack = PATTERN_SPENT_SLACK_ATR * atr;
    const up = g.direction === 'up';
    const failed = bars
        .slice(candidate.endIndex)
        .some(b =>
            up
                ? b.close < g.invalidationLevel - slack
                : b.close > g.invalidationLevel + slack
        );
    if (failed) return true;
    if (!(g.measuredTarget > 0)) return false;
    return bars
        .slice(candidate.endIndex + 1)
        .some(b =>
            up
                ? b.high >= g.measuredTarget - slack
                : b.low <= g.measuredTarget + slack
        );
}
