import type { Bar } from '@/domain/types';
import type {
    ChartPatternId,
    PatternCandidate,
    PivotPoint,
} from '@/domain/patterns/types';
import { EXTREME_MATCH_ATR_MULT } from '@/domain/patterns/constants';

/**
 * A pattern shape matcher — the pre-screener building block that turns
 * extracted pivots (+ the raw bars/ATR they came from) into zero or more
 * {@link PatternCandidate} hits.
 *
 * Recall-biased by design: this is a PRE-screener that selects which pattern
 * skill docs to inject into an AI prompt, not the final judge. A false
 * positive costs a few KB of wasted prompt; a false negative costs the AI
 * never seeing a relevant doc. When a rule is ambiguous, the looser
 * interpretation wins — so classifiers return `[]` only when the geometry
 * genuinely does not fit, never as a tie-breaker.
 *
 * Callers (the Task-1.4 facade) are expected to pass pivots extracted with
 * `includeProvisional: true` so classifiers can see the still-forming
 * extreme at the right edge of the chart — patterns must be recognizable in
 * what is on the chart *now*, not merely somewhere in history.
 *
 * @param pivots - Confirmed (+ optionally provisional) pivots, ascending by
 * bar index, alternating high/low kind.
 * @param bars - The same OHLCV bars the pivots were extracted from.
 * @param atr - Average True Range for the same bars (scale reference).
 * @returns Zero or more candidates; some groups intentionally emit more than
 * one (e.g. a triple top also emits its trailing double top).
 */
export type PatternClassifier = (
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number
) => PatternCandidate[];

// ─── Group 1: extreme matching (double/triple top-bottom) ─────────────────

/**
 * Builds the extreme-matching classifier shared by top/bottom variants.
 *
 * double: the last 2 same-kind pivots are within `EXTREME_MATCH_ATR_MULT *
 * atr` of each other AND at least one opposite-kind pivot lies strictly
 * between them (the neckline). triple: the last 3 same-kind pivots are
 * pairwise within tolerance with opposite-kind pivots interleaved between
 * each consecutive pair — and when a triple matches, its trailing pair
 * (which is exactly the double check on the same data) is emitted too, so a
 * triple always implies a double (recall-biased: both skill docs relevant).
 */
function extremeMatchClassifier(
    extremeKind: 'high' | 'low',
    doubleId: ChartPatternId,
    tripleId: ChartPatternId
): PatternClassifier {
    return (pivots, _bars, atr) => {
        if (atr <= 0) return [];

        const same = pivots.filter(p => p.kind === extremeKind);
        const opposite = pivots.filter(p => p.kind !== extremeKind);
        if (same.length < 2) return [];

        const closeEnough = (a: PivotPoint, b: PivotPoint) =>
            Math.abs(a.price - b.price) <= EXTREME_MATCH_ATR_MULT * atr;
        const hasBetween = (a: PivotPoint, b: PivotPoint) =>
            opposite.some(o => o.index > a.index && o.index < b.index);

        const results: PatternCandidate[] = [];

        if (same.length >= 3) {
            const [p1, p2, p3] = same.slice(-3);
            if (
                closeEnough(p1, p2) &&
                closeEnough(p2, p3) &&
                closeEnough(p1, p3) &&
                hasBetween(p1, p2) &&
                hasBetween(p2, p3)
            ) {
                results.push({
                    id: tripleId,
                    startIndex: p1.index,
                    endIndex: p3.index,
                });
            }
        }

        const [q1, q2] = same.slice(-2);
        if (closeEnough(q1, q2) && hasBetween(q1, q2)) {
            results.push({
                id: doubleId,
                startIndex: q1.index,
                endIndex: q2.index,
            });
        }

        return results;
    };
}

/** double_top / triple_top over the most recent high pivots. */
export const classifyDoubleTripleTop: PatternClassifier =
    extremeMatchClassifier('high', 'double_top', 'triple_top');

/** double_bottom / triple_bottom over the most recent low pivots. */
export const classifyDoubleTripleBottom: PatternClassifier =
    extremeMatchClassifier('low', 'double_bottom', 'triple_bottom');

// ─── Facade ─────────────────────────────────────────────────────────────────

/**
 * All pattern classifiers, one entry per detection group. The Task-1.4
 * facade runs pivots (extracted with `includeProvisional: true`) through
 * every classifier here and flattens the results.
 */
export const CLASSIFIERS: readonly PatternClassifier[] = [
    classifyDoubleTripleTop,
    classifyDoubleTripleBottom,
];
