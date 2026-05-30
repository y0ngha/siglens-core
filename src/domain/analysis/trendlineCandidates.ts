import type {
    Bar,
    SMCResult,
    SMCSwingPoint,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
} from '@/domain/types';
import { extendTrendline } from '@/domain/analysis/trendline';

/**
 * @internal
 * Number of most-recent same-side swing points considered when forming candidate
 * lines. Limiting the window keeps the pairwise search bounded and biases toward
 * the structure most relevant to the current price action.
 */
export const MAX_SWINGS_CONSIDERED = 6;

/**
 * @internal
 * Minimum number of same-side swings that must lie on a line (within tolerance)
 * for it to qualify as a candidate. The two endpoints always count, so this is
 * effectively "endpoints plus zero or more intermediate touches".
 */
export const MIN_TRENDLINE_TOUCHES = 2;

/**
 * @internal
 * Tolerance for counting a swing as a "touch", expressed as a fraction of that
 * swing's own price (0.005 = 0.5%). A swing counts when its actual price is
 * within `fraction * price` of the line's expected price at the swing's time.
 */
export const TRENDLINE_TOUCH_PRICE_FRACTION = 0.005;

/**
 * @internal
 * Maximum candidate lines kept per side (resistance / support) after ranking.
 */
export const MAX_TRENDLINE_CANDIDATES_PER_SIDE = 2;

/**
 * @internal
 * Overall cap on the number of trendline candidates returned across both sides.
 */
export const MAX_TRENDLINE_CANDIDATES = 3;

/**
 * @internal
 * Slope/intercept proximity used to deduplicate near-identical lines. Two lines
 * whose slopes differ by less than this AND whose intercepts differ by less than
 * the recent-price-derived intercept epsilon are treated as duplicates.
 */
const SLOPE_DEDUP_EPSILON = 1e-9;

/**
 * @internal
 * A candidate trendline paired with the scoring metadata used to rank it.
 */
interface ScoredTrendline {
    /** The candidate line (direction + endpoints) that will be emitted. */
    readonly trendline: Trendline;
    /** Count of same-side swings lying on the line within tolerance (incl. endpoints). */
    readonly touches: number;
    /** Slope of the line in price-per-second (used for dedup). */
    readonly slope: number;
    /** Price at time 0 implied by the line (used for dedup). */
    readonly intercept: number;
}

/** An SMC swing resolved to a real bar timestamp + its swing price. */
interface ResolvedSwing {
    readonly time: number;
    readonly price: number;
}

const isFinitePositive = (value: number): boolean =>
    Number.isFinite(value) && value > 0;

/**
 * Resolve same-side swing points to `{ time, price }` using their bar timestamps.
 * Swings whose `index` falls outside the bar array (or non-finite prices) are
 * skipped so every endpoint maps to a real bar.
 */
const resolveSwings = (
    swings: readonly SMCSwingPoint[],
    bars: readonly Bar[]
): ResolvedSwing[] =>
    swings.flatMap(swing => {
        if (swing.index < 0 || swing.index >= bars.length) return [];
        if (!Number.isFinite(swing.price)) return [];
        return [{ time: bars[swing.index].time, price: swing.price }];
    });

/**
 * Direction is derived purely from the price delta between the (time-)earlier and
 * later endpoint. A flat line (equal prices) is reported as `'ascending'`
 * deterministically — the choice is arbitrary but stable.
 */
const directionFor = (
    start: TrendlinePoint,
    end: TrendlinePoint
): TrendlineDirection => (end.price < start.price ? 'descending' : 'ascending');

/**
 * Score one ordered pair of resolved swings against all same-side swings. Returns
 * `null` when the pair shares a timestamp (degenerate, vertical line) or fails to
 * reach `MIN_TRENDLINE_TOUCHES`.
 */
const scorePair = (
    earlier: ResolvedSwing,
    later: ResolvedSwing,
    sameSideSwings: readonly ResolvedSwing[]
): ScoredTrendline | null => {
    if (earlier.time === later.time) return null;

    const start: TrendlinePoint = { time: earlier.time, price: earlier.price };
    const end: TrendlinePoint = { time: later.time, price: later.price };
    const trendline: Trendline = {
        direction: directionFor(start, end),
        start,
        end,
    };

    let touches = 0;
    for (const swing of sameSideSwings) {
        const expected = extendTrendline(trendline, swing.time).price;
        const tolerance = TRENDLINE_TOUCH_PRICE_FRACTION * swing.price;
        if (Math.abs(swing.price - expected) <= tolerance) {
            touches += 1;
        }
    }

    if (touches < MIN_TRENDLINE_TOUCHES) return null;

    const slope = (end.price - start.price) / (end.time - start.time);
    const intercept = start.price - slope * start.time;

    return { trendline, touches, slope, intercept };
};

/**
 * Rank: more touches first, then a more recent end time, then a longer time span.
 */
const byRank = (a: ScoredTrendline, b: ScoredTrendline): number => {
    if (a.touches !== b.touches) return b.touches - a.touches;
    if (a.trendline.end.time !== b.trendline.end.time) {
        return b.trendline.end.time - a.trendline.end.time;
    }
    const spanA = a.trendline.end.time - a.trendline.start.time;
    const spanB = b.trendline.end.time - b.trendline.start.time;
    return spanB - spanA;
};

/**
 * Greedily keep top-ranked candidates, dropping any that share endpoints with, or
 * are near-collinear (same slope + intercept) to, an already-kept candidate.
 */
const dedupAndCap = (
    scored: readonly ScoredTrendline[],
    cap: number
): ScoredTrendline[] => {
    const kept: ScoredTrendline[] = [];

    for (const candidate of scored) {
        if (kept.length >= cap) break;

        const interceptEpsilon =
            Math.abs(candidate.intercept) * SLOPE_DEDUP_EPSILON;
        const isDuplicate = kept.some(existing => {
            const sameEndpoints =
                existing.trendline.start.time ===
                    candidate.trendline.start.time &&
                existing.trendline.end.time === candidate.trendline.end.time;
            const sameLine =
                Math.abs(existing.slope - candidate.slope) <
                    SLOPE_DEDUP_EPSILON &&
                Math.abs(existing.intercept - candidate.intercept) <=
                    interceptEpsilon;
            return sameEndpoints || sameLine;
        });

        if (!isDuplicate) kept.push(candidate);
    }

    return kept;
};

/**
 * Build, score, and rank candidate lines for a single side (resistance or
 * support). Considers only the most recent `MAX_SWINGS_CONSIDERED` swings and
 * forms a line from every ordered pair `(i < j)` of those swings.
 */
const candidatesForSide = (
    swings: readonly ResolvedSwing[]
): ScoredTrendline[] => {
    const recent = swings.slice(-MAX_SWINGS_CONSIDERED);
    if (recent.length < MIN_TRENDLINE_TOUCHES) return [];

    const scored: ScoredTrendline[] = [];
    for (let i = 0; i < recent.length; i += 1) {
        for (let j = i + 1; j < recent.length; j += 1) {
            const a = recent[i];
            const b = recent[j];
            const earlier = a.time <= b.time ? a : b;
            const later = a.time <= b.time ? b : a;
            const candidate = scorePair(earlier, later, recent);
            if (candidate !== null) scored.push(candidate);
        }
    }

    return dedupAndCap(
        scored.toSorted(byRank),
        MAX_TRENDLINE_CANDIDATES_PER_SIDE
    );
};

/**
 * Precompute candidate trendlines from detected SMC swing points.
 *
 * Each swing maps to a real bar timestamp (`bars[swing.index].time`) and its
 * swing price, so every endpoint is a genuine chart coordinate rather than an
 * LLM-invented one. Resistance candidates are built from swing highs and support
 * candidates from swing lows, independently. For each side the most recent
 * {@link MAX_SWINGS_CONSIDERED} swings are paired up; each pair forms a line that
 * is scored by how many same-side swings sit on it within
 * {@link TRENDLINE_TOUCH_PRICE_FRACTION} of the swing price (endpoints always
 * count). Lines with fewer than {@link MIN_TRENDLINE_TOUCHES} touches are dropped.
 *
 * Qualifying lines are ranked by touches, then end-time recency, then span;
 * near-identical lines are deduplicated; each side keeps at most
 * {@link MAX_TRENDLINE_CANDIDATES_PER_SIDE} and the combined result is capped at
 * {@link MAX_TRENDLINE_CANDIDATES}. The AI selects from these candidates and
 * reuses their exact endpoints, which removes timestamp/price hallucination while
 * leaving interpretation to the model.
 *
 * Pure and deterministic: inputs are never mutated.
 *
 * @param bars - OHLCV bars sorted oldest-first; supplies real endpoint timestamps.
 * @param smc - SMC analysis providing the swing highs/lows.
 * @returns Up to {@link MAX_TRENDLINE_CANDIDATES} candidate trendlines (possibly empty).
 * @internal
 */
export function computeTrendlineCandidates(
    bars: Bar[],
    smc: SMCResult
): Trendline[] {
    if (bars.length === 0) return [];

    const resistanceSwings = resolveSwings(smc.swingHighs, bars).filter(s =>
        isFinitePositive(s.price)
    );
    const supportSwings = resolveSwings(smc.swingLows, bars).filter(s =>
        isFinitePositive(s.price)
    );

    const resistance = candidatesForSide(resistanceSwings);
    const support = candidatesForSide(supportSwings);

    return [...resistance, ...support]
        .toSorted(byRank)
        .slice(0, MAX_TRENDLINE_CANDIDATES)
        .map(scored => scored.trendline);
}
