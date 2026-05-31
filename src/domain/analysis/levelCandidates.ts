import type {
    Bar,
    IndicatorResult,
    LevelCandidate,
    LevelCandidates,
    LevelCandidateSource,
} from '@/domain/types';
import { lastNonNull } from '@/domain/indicators/utils';
import { lastOf } from '@/domain/analysis/analysisUtils';

/** @internal Maximum number of candidate levels returned per side (support / resistance). */
export const MAX_LEVEL_CANDIDATES_PER_SIDE = 5;

/**
 * @internal
 * Two raw levels are treated as the same (confluent) level when their prices are
 * within this fraction of the cluster anchor (0.005 = 0.5%). Sized to merge
 * indicators that practically coincide (e.g. POC and a nearby MA) without
 * collapsing genuinely distinct levels.
 */
export const CONFLUENCE_TOLERANCE_FRACTION = 0.005;

/**
 * @internal
 * Half-width of the band around a clustered level used to count tested history,
 * expressed as a fraction of the level price (0.0025 = 0.25%). A bar counts as a
 * touch when its [low, high] range intersects `level ± fraction * level`.
 */
export const TOUCH_TOLERANCE_FRACTION = 0.0025;

/**
 * @internal
 * Weight applied to each distinct confluent source when scoring strength. A
 * level confirmed by N distinct sources contributes `N * CONFLUENCE_WEIGHT`,
 * while each historical test adds 1. Confluence is weighted above a single test
 * because agreement across independent indicators is a stronger signal than one
 * incidental bar crossing the level, yet a heavily-tested lone level can still
 * out-rank a thin two-source confluence once it accumulates enough tests.
 */
export const CONFLUENCE_WEIGHT = 2;

const PERCENTAGE_FACTOR = 100;
const DISTANCE_DECIMAL_FACTOR = 100;

interface RawLevel {
    price: number;
    source: LevelCandidateSource;
}

/** A confluence cluster: a merged price plus the distinct sources that agree on it. */
interface ClusteredLevel {
    price: number;
    sources: LevelCandidateSource[];
}

const isUsablePrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;

const collectMovingAverageLevels = (
    series: Record<number, (number | null)[]>,
    prefix: 'MA' | 'EMA'
): RawLevel[] =>
    Object.entries(series).flatMap(([period, values]) => {
        const last = lastNonNull(values);
        if (last === null) return [];
        const source: LevelCandidateSource = `${prefix}${Number(period)}`;
        return [{ price: last, source }];
    });

const collectRawLevels = (indicators: IndicatorResult): RawLevel[] => {
    const vp = indicators.volumeProfile;
    const volumeProfileLevels: RawLevel[] =
        vp !== null
            ? [
                  { price: vp.poc, source: 'POC' },
                  { price: vp.vah, source: 'VAH' },
                  { price: vp.val, source: 'VAL' },
              ]
            : [];

    const lastBollinger = lastOf(indicators.bollinger);
    const bollingerLevels: RawLevel[] = [
        // `as const` keeps the literal from widening to `string` inside the
        // conditional spread so it still satisfies `LevelCandidateSource`;
        // runtime-safe because the value is always the literal 'BB upper'.
        ...(lastBollinger?.upper != null
            ? [{ price: lastBollinger.upper, source: 'BB upper' as const }]
            : []),
        // Same rationale: pins the literal to `LevelCandidateSource`; the
        // runtime value is always the literal 'BB lower'.
        ...(lastBollinger?.lower != null
            ? [{ price: lastBollinger.lower, source: 'BB lower' as const }]
            : []),
    ];

    const swingHighLevels: RawLevel[] = indicators.smc.swingHighs.map(s => ({
        price: s.price,
        source: 'swing high',
    }));
    const swingLowLevels: RawLevel[] = indicators.smc.swingLows.map(s => ({
        price: s.price,
        source: 'swing low',
    }));

    return [
        ...volumeProfileLevels,
        ...collectMovingAverageLevels(indicators.ma, 'MA'),
        ...collectMovingAverageLevels(indicators.ema, 'EMA'),
        ...bollingerLevels,
        ...swingHighLevels,
        ...swingLowLevels,
    ];
};

/**
 * Greedily cluster price-sorted raw levels into confluence groups. A cluster is
 * anchored on its first (lowest-priced) member; the next level joins while it is
 * within `CONFLUENCE_TOLERANCE_FRACTION * anchorPrice` of that anchor, otherwise
 * it starts a new cluster. Each cluster emits the mean of its member prices and
 * the de-duplicated union of their source labels.
 */
const clusterRawLevels = (rawLevels: readonly RawLevel[]): ClusteredLevel[] => {
    const sorted = rawLevels.toSorted((a, b) => a.price - b.price);

    const groups: RawLevel[][] = [];
    for (const level of sorted) {
        const current = groups.at(-1);
        const anchorPrice = current?.[0].price;
        const withinTolerance =
            anchorPrice !== undefined &&
            Math.abs(level.price - anchorPrice) <=
                CONFLUENCE_TOLERANCE_FRACTION * anchorPrice;

        // Local mutable accumulator: spreading on each step would be O(N²);
        // inputs are not mutated and the result is fresh.
        if (current !== undefined && withinTolerance) {
            current.push(level);
        } else {
            groups.push([level]);
        }
    }

    return groups.map(members => {
        const price =
            members.reduce((sum, m) => sum + m.price, 0) / members.length;
        const sources = [...new Set(members.map(m => m.source))];
        return { price, sources };
    });
};

/**
 * Count bars whose [low, high] range intersects the touch band centred on the
 * clustered level. Bars with non-finite low/high are skipped so malformed data
 * never inflates the count.
 */
const countTouches = (price: number, bars: readonly Bar[]): number => {
    const halfWidth = TOUCH_TOLERANCE_FRACTION * price;
    const lowerBound = price - halfWidth;
    const upperBound = price + halfWidth;

    return bars.filter(bar => {
        if (!Number.isFinite(bar.low) || !Number.isFinite(bar.high)) {
            return false;
        }
        return bar.low <= upperBound && bar.high >= lowerBound;
    }).length;
};

/**
 * Strength rises with both the count of distinct confluent sources and the
 * number of historical tests; see {@link CONFLUENCE_WEIGHT} for the weighting.
 */
const strengthOf = (candidate: LevelCandidate): number =>
    candidate.sources.length * CONFLUENCE_WEIGHT + candidate.touchCount;

const toCandidate = (
    cluster: ClusteredLevel,
    currentPrice: number,
    bars: readonly Bar[]
): LevelCandidate => {
    const rawDistance =
        (Math.abs(cluster.price - currentPrice) / currentPrice) *
        PERCENTAGE_FACTOR;
    const distancePercent =
        Math.round(rawDistance * DISTANCE_DECIMAL_FACTOR) /
        DISTANCE_DECIMAL_FACTOR;
    return {
        price: cluster.price,
        // `sources` is always non-empty for a real cluster; the first member is
        // the primary source exposed via the deprecated `source` alias.
        source: cluster.sources[0],
        sources: cluster.sources,
        touchCount: countTouches(cluster.price, bars),
        distancePercent,
    };
};

/** Rank: strongest first, then nearest-to-price as a deterministic tiebreak. */
const byStrengthThenDistance = (
    a: LevelCandidate,
    b: LevelCandidate
): number => {
    const strengthDelta = strengthOf(b) - strengthOf(a);
    if (strengthDelta !== 0) return strengthDelta;
    return a.distancePercent - b.distancePercent;
};

/**
 * Derive deterministic support/resistance candidates from indicator and SMC data,
 * ranked by level strength.
 *
 * Gathers price levels already computed elsewhere — Volume Profile POC/VAH/VAL,
 * the latest value of every moving average (MA/EMA), the latest Bollinger Band
 * upper/lower bounds, and SMC swing highs/lows. Raw levels whose prices coincide
 * within {@link CONFLUENCE_TOLERANCE_FRACTION} are merged into a single
 * confluence cluster (mean price, union of distinct sources). For each cluster a
 * touch count is derived from how many `bars` traded through a band of
 * {@link TOUCH_TOLERANCE_FRACTION} around the level, a deterministic proxy for
 * how often the level was tested.
 *
 * Clusters are split by side relative to `currentPrice`: strictly below becomes
 * support, strictly above becomes resistance; levels equal to the current price,
 * non-finite, or non-positive are discarded. Each side is ranked by strength
 * (confluence of distinct sources plus tested history — see
 * {@link CONFLUENCE_WEIGHT}) descending, breaking ties by nearest-to-price, then
 * capped to {@link MAX_LEVEL_CANDIDATES_PER_SIDE}. The AI selects from these
 * candidates and writes the rationale, which removes price-arithmetic
 * hallucination while keeping interpretation in the model's hands.
 *
 * Pure and deterministic: inputs are never mutated.
 *
 * @param currentPrice - Latest bar close used as the support/resistance pivot.
 * @param indicators - Indicator suite produced by `calculateIndicators`.
 * @param bars - OHLCV bars sorted oldest-first; supply the tested-history count.
 *   Optional — when omitted, every candidate's `touchCount` is `0`.
 * @returns Support and resistance candidate lists, strongest first.
 */
export function computeLevelCandidates(
    currentPrice: number,
    indicators: IndicatorResult,
    bars: readonly Bar[] = []
): LevelCandidates {
    if (!isUsablePrice(currentPrice)) {
        return { support: [], resistance: [] };
    }

    const candidates = clusterRawLevels(
        collectRawLevels(indicators).filter(raw => isUsablePrice(raw.price))
    )
        .filter(cluster => isUsablePrice(cluster.price))
        .map(cluster => toCandidate(cluster, currentPrice, bars));

    const support = candidates
        .filter(c => c.price < currentPrice)
        .toSorted(byStrengthThenDistance)
        .slice(0, MAX_LEVEL_CANDIDATES_PER_SIDE);
    const resistance = candidates
        .filter(c => c.price > currentPrice)
        .toSorted(byStrengthThenDistance)
        .slice(0, MAX_LEVEL_CANDIDATES_PER_SIDE);

    return { support, resistance };
}
