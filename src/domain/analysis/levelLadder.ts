import { round2 } from '@/domain/agent/statsMath';
import { formatPlainNumber } from '@/domain/plainNumber';

/** Where a candidate price came from. Analysis kinds come from a stored analysis, the rest from daily bars. */
export type LevelSourceKind =
    | 'analysis_support'
    | 'analysis_resistance'
    | 'analysis_poc'
    | 'analysis_target'
    | 'analysis_stop'
    | 'high_52w'
    | 'low_52w'
    | 'high_20'
    | 'low_20'
    | 'sma20'
    | 'sma50'
    | 'sma200';

/** One price a source printed, with its origin. */
export interface LevelCandidate {
    readonly price: number;
    readonly kind: LevelSourceKind;
}

/** One distinct price on the ladder with every source that printed exactly that price. */
export interface LevelRung {
    price: number;
    /** `(price − referencePrice) / referencePrice × 100`, 2 decimals; negative below the reference. A sub-0.01% gap rounds to 0 but the summary still prints its side as `+<0.01%` / `-<0.01%`. */
    distancePct: number;
    /** Display labels of every merged kind, in the fixed order of the `LevelSourceKind` union (analysis kinds, then highs and lows, then averages). */
    sources: string[];
}

/** Which side's nearest rung is closer by the printed `distancePct`. */
export type LevelLadderCloser = 'above' | 'below' | 'equal';

/** Levels placed by their side of the reference price, nearest first. */
export interface LevelLadder {
    referencePrice: number;
    /** Rungs strictly above the reference price, nearest first, at most 4. */
    above: LevelRung[];
    /** Rungs strictly below the reference price, nearest first, same cap. */
    below: LevelRung[];
    /** The rung whose price equals the reference price exactly (zero or one entry). */
    atPrice: LevelRung[];
    /**
     * Whichever of `above[0]` and `below[0]` has the smaller printed `|distancePct|`; when those
     * print the same, the unrounded gap decides, and `'equal'` only when that ties too. `null`
     * when either side is empty.
     */
    closer: LevelLadderCloser | null;
    /** One deterministic English line over the nearest rungs. */
    summary: string;
}

/** @internal Cap on rungs kept per side; the farther ones are not listed. */
export const LEVEL_LADDER_RUNGS_PER_SIDE = 4;

/** Display order of merged sources, and the single source of the kind list. */
const LEVEL_SOURCE_ORDER = [
    'analysis_support',
    'analysis_resistance',
    'analysis_poc',
    'analysis_target',
    'analysis_stop',
    'high_52w',
    'low_52w',
    'high_20',
    'low_20',
    'sma20',
    'sma50',
    'sma200',
] as const satisfies readonly LevelSourceKind[];

/**
 * Labels the model reads. The "-day" labels describe daily bars: a caller passes the
 * chart kinds only for a daily series.
 */
const LEVEL_SOURCE_LABELS: Record<LevelSourceKind, string> = {
    analysis_support: 'analysis support',
    analysis_resistance: 'analysis resistance',
    analysis_poc: 'analysis volume node',
    analysis_target: 'analysis target',
    analysis_stop: 'analysis stop',
    high_52w: '52-week high',
    low_52w: '52-week low',
    high_20: '20-day high',
    low_20: '20-day low',
    sma20: '20-day average',
    sma50: '50-day average',
    sma200: '200-day average',
};

const RATIO_TO_PERCENT = 100;

function isUsablePrice(price: number): boolean {
    return Number.isFinite(price) && price > 0;
}

/** Candidates of one exact price, as the kinds that printed it. */
interface PriceGroup {
    price: number;
    kinds: ReadonlySet<LevelSourceKind>;
}

function groupByPrice(candidates: readonly LevelCandidate[]): PriceGroup[] {
    const byPrice = candidates.reduce(
        (groups, { price, kind }) =>
            groups.set(price, (groups.get(price) ?? new Set()).add(kind)),
        new Map<number, Set<LevelSourceKind>>()
    );
    return [...byPrice].map(([price, kinds]) => ({ price, kinds }));
}

function toRung(group: PriceGroup, referencePrice: number): LevelRung {
    return {
        price: group.price,
        distancePct: round2(
            ((group.price - referencePrice) / referencePrice) * RATIO_TO_PERCENT
        ),
        sources: LEVEL_SOURCE_ORDER.filter(kind => group.kinds.has(kind)).map(
            kind => LEVEL_SOURCE_LABELS[kind]
        ),
    };
}

/**
 * Which side's nearest rung is closer. The printed (rounded) distances decide; when they
 * print the same, the unrounded gaps break the tie, and only an exact tie is `'equal'`.
 * That keeps two sub-cent rungs on opposite sides from reading as equally close.
 */
function closerSide(
    above: readonly LevelRung[],
    below: readonly LevelRung[],
    referencePrice: number
): LevelLadderCloser | null {
    const nearestAbove = above[0];
    const nearestBelow = below[0];
    if (nearestAbove === undefined || nearestBelow === undefined) return null;
    const printedGap =
        Math.abs(nearestAbove.distancePct) - Math.abs(nearestBelow.distancePct);
    const gap =
        printedGap ||
        nearestAbove.price -
            referencePrice -
            (referencePrice - nearestBelow.price);
    if (gap === 0) return 'equal';
    return gap < 0 ? 'above' : 'below';
}

/** Distance text; a rung that rounds to 0 keeps the sign of its side (`+<0.01%`), only an at-price rung prints `0%`. */
function signedDistance(rung: LevelRung, referencePrice: number): string {
    if (rung.distancePct === 0 && rung.price !== referencePrice) {
        return rung.price > referencePrice ? '+<0.01%' : '-<0.01%';
    }
    const text = formatPlainNumber(rung.distancePct);
    return rung.distancePct > 0 ? `+${text}%` : `${text}%`;
}

function describeRung(rung: LevelRung, referencePrice: number): string {
    return `${formatPlainNumber(rung.price)} (${signedDistance(rung, referencePrice)}, ${rung.sources.join(', ')})`;
}

function nearestSentence(
    label: string,
    rung: LevelRung | undefined,
    referencePrice: number
): string {
    return `${label}: ${rung === undefined ? 'none listed' : describeRung(rung, referencePrice)}.`;
}

const CLOSER_SENTENCE: Record<LevelLadderCloser, string> = {
    above: 'The level above is closer.',
    below: 'The level below is closer.',
    equal: 'The two levels are equally close.',
};

function buildSummary(
    above: readonly LevelRung[],
    below: readonly LevelRung[],
    atPrice: readonly LevelRung[],
    closer: LevelLadderCloser | null,
    referencePrice: number
): string {
    const atRung = atPrice[0];
    return [
        nearestSentence('Nearest above', above[0], referencePrice),
        nearestSentence('Nearest below', below[0], referencePrice),
        ...(atRung === undefined
            ? []
            : [`At the price: ${describeRung(atRung, referencePrice)}.`]),
        ...(closer === null ? [] : [CLOSER_SENTENCE[closer]]),
    ].join(' ');
}

/**
 * Places candidate prices by their side of the reference price, nearest first.
 *
 * The side comes from the price alone, never from the role a source gave it: an
 * analysis support that now sits above the price is an `above` rung. Only exactly
 * equal prices merge (their sources are listed together); nothing is clustered or
 * averaged, so every rung price is one a source printed. A price equal to the
 * reference is reported apart in `atPrice`, never as above or below, and there is
 * no "near the price" band. Candidates that are not finite and positive are dropped.
 *
 * @param referencePrice - The reference price the caller passes (the latest close or a live quote).
 * @param candidates - Prices from any mix of sources, any order.
 * @returns The ladder, or `null` when the reference price is not finite and positive
 *   or no candidate survives.
 *
 * @example
 * ```ts
 * buildLevelLadder(51.7, [{ price: 52.4, kind: 'high_52w' }, { price: 50.1, kind: 'sma50' }])?.summary;
 * // 'Nearest above: 52.4 (+1.35%, 52-week high). Nearest below: 50.1 (-3.09%, 50-day average). The level above is closer.'
 * ```
 */
export function buildLevelLadder(
    referencePrice: number,
    candidates: readonly LevelCandidate[]
): LevelLadder | null {
    if (!isUsablePrice(referencePrice)) return null;
    const groups = groupByPrice(
        candidates.filter(candidate => isUsablePrice(candidate.price))
    );
    if (groups.length === 0) return null;
    const rungsOf = (side: (price: number) => boolean): LevelRung[] =>
        groups
            .filter(group => side(group.price))
            .map(group => toRung(group, referencePrice));
    const above = rungsOf(price => price > referencePrice)
        .sort((a, b) => a.price - b.price)
        .slice(0, LEVEL_LADDER_RUNGS_PER_SIDE);
    const below = rungsOf(price => price < referencePrice)
        .sort((a, b) => b.price - a.price)
        .slice(0, LEVEL_LADDER_RUNGS_PER_SIDE);
    const atPrice = rungsOf(price => price === referencePrice);
    const closer = closerSide(above, below, referencePrice);
    return {
        referencePrice,
        above,
        below,
        atPrice,
        closer,
        summary: buildSummary(above, below, atPrice, closer, referencePrice),
    };
}
