import type {
    Bar,
    QualifiedPattern,
    QualifiedPatternGeometry,
} from '@/domain/types';
import { PATTERN_SPENT_SLACK_ATR } from '@/domain/patterns/constants';

/**
 * @internal
 * A qualified pattern the price has already moved past, so it describes the
 * past and is neither offered to the model nor drawn (2026-10-02: 1.4% of
 * real-data hits had already failed, 1.4% had already hit their target).
 *
 * - Failed: any close beyond the FIXED invalidation level (spec 2026-10-07
 *   §4), with no slack, counted from the bar that set it
 *   (`invalidationIndex`) — earlier bars of the pattern legitimately sit
 *   beyond it, like a rising support's earlier lows. A level that followed
 *   the last close down could never be crossed. No slack because the prompt
 *   block prints "a close beyond the invalidation level invalidates" next to
 *   the status: a pattern whose own rule already fired would contradict its
 *   card (2026-10-08 A/B: a cup offered as forming with the last close 0.22
 *   ATR under its handle low, inside the 0.25 ATR slack it used to get).
 *   Every close, not just the last: a close that crossed and came back has
 *   still met the rule, and a last-close-only check made a pattern vanish
 *   for one bar and come back (sweep flicker 4 → 10). Every directed family
 *   reaches the prompt through this check.
 * - Fulfilled: a bar after the pattern's last structural point reaching the
 *   measured target. Not counted from the first point: a converging pattern's
 *   target often sits inside its own earlier range (a rising wedge's target
 *   is below its first support touch). The last structural point is a
 *   confirmed pivot now, not the still-forming bar it used to be. A target at
 *   or below zero is not a price and is never fulfilled. Allows
 *   PATTERN_SPENT_SLACK_ATR of slack (price reacts in a zone).
 * - Undirected (no prior trend, no target): spent once a bar after the last
 *   touch has travelled a full height beyond either boundary, the boundaries
 *   read where they stand at the last bar (with the same slack).
 */
export function isSpentPattern(
    pattern: QualifiedPattern,
    geometry: QualifiedPatternGeometry,
    bars: readonly Bar[],
    atr: number
): boolean {
    const slack = PATTERN_SPENT_SLACK_ATR * atr;
    if (geometry.direction === null) {
        const reach = geometry.height - slack;
        return bars
            .slice(pattern.endIndex + 1)
            .some(
                b =>
                    b.high >= geometry.upperLevel + reach ||
                    b.low <= geometry.lowerLevel - reach
            );
    }
    const up = geometry.direction === 'up';
    const failed = bars
        .slice(geometry.invalidationIndex)
        .some(b =>
            up
                ? b.close < geometry.invalidationLevel
                : b.close > geometry.invalidationLevel
        );
    if (failed) return true;
    if (!(geometry.measuredTarget > 0)) return false;
    return bars
        .slice(pattern.endIndex + 1)
        .some(b =>
            up
                ? b.high >= geometry.measuredTarget - slack
                : b.low <= geometry.measuredTarget + slack
        );
}
