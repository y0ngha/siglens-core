import type {
    IndicatorResult,
    LevelCandidate,
    LevelCandidates,
    LevelCandidateSource,
} from '@/domain/types';
import { lastNonNull } from '@/domain/indicators/utils';
import { lastOf } from '@/domain/analysis/analysisUtils';

/** @internal Maximum number of candidate levels returned per side (support / resistance). */
export const MAX_LEVEL_CANDIDATES_PER_SIDE = 5;

const PERCENTAGE_FACTOR = 100;
const DISTANCE_DECIMAL_FACTOR = 100;

interface RawLevel {
    price: number;
    source: LevelCandidateSource;
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

const toCandidate = (raw: RawLevel, currentPrice: number): LevelCandidate => {
    const rawDistance =
        (Math.abs(raw.price - currentPrice) / currentPrice) * PERCENTAGE_FACTOR;
    const distancePercent =
        Math.round(rawDistance * DISTANCE_DECIMAL_FACTOR) /
        DISTANCE_DECIMAL_FACTOR;
    return { price: raw.price, source: raw.source, distancePercent };
};

const nearestFirst = (a: LevelCandidate, b: LevelCandidate): number =>
    a.distancePercent - b.distancePercent;

/**
 * Derive deterministic support/resistance candidates from indicator and SMC data.
 *
 * Gathers price levels that are already computed elsewhere — Volume Profile
 * POC/VAH/VAL, the latest value of every moving average (MA/EMA), the latest
 * Bollinger Band upper/lower bounds, and SMC swing highs/lows — then splits them
 * by side relative to `currentPrice`: levels strictly below become support
 * candidates, levels strictly above become resistance candidates. Levels equal
 * to the current price, non-finite, or non-positive are discarded.
 *
 * Each side is sorted nearest-to-price first and capped to a fixed maximum.
 * The AI selects from these candidates and writes the rationale, which removes
 * price-arithmetic hallucination while keeping interpretation in the model's
 * hands.
 *
 * @param currentPrice - Latest bar close used as the support/resistance pivot.
 * @param indicators - Indicator suite produced by `calculateIndicators`.
 * @returns Support and resistance candidate lists, nearest-to-price first.
 */
export function computeLevelCandidates(
    currentPrice: number,
    indicators: IndicatorResult
): LevelCandidates {
    if (!isUsablePrice(currentPrice)) {
        return { support: [], resistance: [] };
    }

    const candidates = collectRawLevels(indicators)
        .filter(raw => isUsablePrice(raw.price))
        .map(raw => toCandidate(raw, currentPrice));

    const support = candidates
        .filter(c => c.price < currentPrice)
        .toSorted(nearestFirst)
        .slice(0, MAX_LEVEL_CANDIDATES_PER_SIDE);
    const resistance = candidates
        .filter(c => c.price > currentPrice)
        .toSorted(nearestFirst)
        .slice(0, MAX_LEVEL_CANDIDATES_PER_SIDE);

    return { support, resistance };
}
