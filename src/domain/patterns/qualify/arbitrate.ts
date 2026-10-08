import type {
    ChartPatternId,
    PatternBreakoutDirection,
    QualifiedPattern,
} from '@/domain/types';
import {
    ARBITRATION_MAX_SPAN_OVERLAP,
    ARBITRATION_MIN_SHARED_PIVOTS,
} from '@/domain/patterns/constants';

// ─── Arbitration (§2.5) ─────────────────────────────────────────────────────

/**
 * Rank among overlapping qualified hits — lower wins. Encodes the spec's
 * chains (H&S > triple > double; high tight flag > flags > triangles/wedges;
 * cup > rounding; triangles/wedges > channels/broadening > rectangle) as one
 * order. Where the spec gives no order, every boundary pattern ranks above
 * doubles and triples: a boundary pair needs five interleaved touches
 * (`boundariesInterleave`) and a rectangle three per side, so when one
 * qualifies it describes the range more fully than a double or triple built
 * from one side of it (flat highs over rising lows are an ascending triangle,
 * not a triple top). Rounding bases rank with channels.
 */
const ARBITRATION_RANK: Record<ChartPatternId, number> = {
    head_and_shoulders: 1,
    inverse_head_and_shoulders: 1,
    high_tight_flag: 1,
    cup_and_handle: 1,
    bull_flag: 2,
    bear_flag: 2,
    pennant: 2,
    ascending_triangle: 3,
    descending_triangle: 3,
    symmetrical_triangle: 3,
    ascending_wedge: 3,
    descending_wedge: 3,
    ascending_channel: 4,
    descending_channel: 4,
    broadening_formation: 4,
    rounding_bottom: 4,
    rounding_top: 4,
    rectangle: 5,
    triple_top: 6,
    triple_bottom: 6,
    double_top: 7,
    double_bottom: 7,
};

/** @internal */
export interface Contender {
    pattern: QualifiedPattern;
    direction: PatternBreakoutDirection | null;
}

/**
 * @internal
 * Keeps one hit per overlapping group: two hits overlap when they share
 * `ARBITRATION_MIN_SHARED_PIVOTS` pivots, when their spans overlap by more
 * than `ARBITRATION_MAX_SPAN_OVERLAP` of the shorter span, or when their
 * spans overlap at all and their directions are opposite. The better rank
 * wins, then more touches, then the more recent end.
 */
export function arbitrate(contenders: readonly Contender[]): Contender[] {
    const ordered = contenders.toSorted(
        (a, b) =>
            ARBITRATION_RANK[a.pattern.id] - ARBITRATION_RANK[b.pattern.id] ||
            b.pattern.touches - a.pattern.touches ||
            b.pattern.endIndex - a.pattern.endIndex
    );
    const kept: Contender[] = [];
    for (const contender of ordered) {
        if (!kept.some(k => overlaps(k, contender))) kept.push(contender);
    }
    return kept;
}

function overlaps(a: Contender, b: Contender): boolean {
    const shared = a.pattern.pivots.filter(p =>
        b.pattern.pivots.some(q => q.index === p.index && q.kind === p.kind)
    ).length;
    if (shared >= ARBITRATION_MIN_SHARED_PIVOTS) return true;
    const overlap =
        Math.min(a.pattern.endIndex, b.pattern.endIndex) -
        Math.max(a.pattern.startIndex, b.pattern.startIndex);
    if (overlap <= 0) return false;
    const shorter = Math.min(
        a.pattern.endIndex - a.pattern.startIndex,
        b.pattern.endIndex - b.pattern.startIndex
    );
    if (overlap > ARBITRATION_MAX_SPAN_OVERLAP * shorter) return true;
    return (
        a.direction !== null &&
        b.direction !== null &&
        a.direction !== b.direction
    );
}
