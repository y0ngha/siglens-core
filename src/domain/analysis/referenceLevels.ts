import type {
    IndicatorLevelOptions,
    IndicatorResult,
    ReferenceLevel,
    ReferenceLevels,
} from '@/domain/types';
import {
    MAX_REFERENCE_LEVELS_PER_SIDE,
    RATIO_TO_PERCENT,
    ROUND_NUMBER_TIERS,
} from '@/domain/analysis/marketReferenceConstants';

/** Number of round levels to emit on each side of price. */
const ROUND_LEVELS_PER_SIDE = 2;

/** Extra candidate above base so the resistance side keeps >= ROUND_LEVELS_PER_SIDE levels. */
const ROUND_LEVELS_UPPER_EXTRA = 1;

/** Decimal places used to normalize emitted round-number prices. */
const ROUND_PRICE_PRECISION = 4;

// The final tier's ceiling is +Infinity, so find() always matches; the `??`
// only satisfies the type checker and reuses that tier's increment (no second
// source of truth for the top-tier value).
const incrementFor = (price: number): number =>
    (
        ROUND_NUMBER_TIERS.find(t => price <= t.maxPrice) ??
        ROUND_NUMBER_TIERS[ROUND_NUMBER_TIERS.length - 1]
    ).increment;

const roundLabel = (price: number): string => `Round ${price}`;

/** @internal Nearest round-number levels above and below the price (advisory psychology). */
export function roundNumberLevels(currentPrice: number): ReferenceLevel[] {
    if (!(Number.isFinite(currentPrice) && currentPrice > 0)) return [];
    const inc = incrementFor(currentPrice);
    const base = Math.floor(currentPrice / inc) * inc;
    const levels: ReferenceLevel[] = [];
    for (
        let i = -ROUND_LEVELS_PER_SIDE;
        i <= ROUND_LEVELS_PER_SIDE + ROUND_LEVELS_UPPER_EXTRA;
        i++
    ) {
        const price = Number((base + i * inc).toFixed(ROUND_PRICE_PRECISION));
        if (price <= 0) continue;
        levels.push({
            price,
            label: roundLabel(price),
            kind: 'round',
            distancePercent:
                ((price - currentPrice) / currentPrice) * RATIO_TO_PERCENT,
        });
    }
    return levels;
}

/** Fraction of price within which two levels are treated as duplicates (0.1%). */
const DEDUPE_FRACTION = 0.001;

/** @internal Last finite, non-null value in a numeric series (or null). */
export const lastFiniteNumber = (
    arr: readonly (number | null)[]
): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
        const v = arr[i];
        if (v != null && Number.isFinite(v)) return v;
    }
    return null;
};

const lastField = <T>(
    arr: readonly T[],
    pick: (t: T) => number | null | undefined
): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
        const v = pick(arr[i]);
        if (v != null && Number.isFinite(v)) return v;
    }
    return null;
};

/** @internal Build a ReferenceLevel with its signed percent distance from price. */
export const makeReferenceLevel = (
    price: number,
    label: string,
    kind: ReferenceLevel['kind'],
    currentPrice: number
): ReferenceLevel => ({
    price,
    label,
    kind,
    distancePercent: ((price - currentPrice) / currentPrice) * RATIO_TO_PERCENT,
});

/** @internal A finite, positive reference level, or null to drop it. */
const toLevel = (
    price: number | null,
    label: string,
    kind: ReferenceLevel['kind'],
    currentPrice: number
): ReferenceLevel | null =>
    price != null && Number.isFinite(price) && price > 0
        ? makeReferenceLevel(price, label, kind, currentPrice)
        : null;

/** A candidate level before validation: its raw price, label, and kind. */
type LevelCandidate = readonly [
    price: number | null,
    label: string,
    kind: ReferenceLevel['kind'],
];

/** @internal Latest-value reference levels from the indicator suite. */
export function collectIndicatorLevels(
    currentPrice: number,
    indicators: IndicatorResult,
    options?: IndicatorLevelOptions
): ReferenceLevel[] {
    const vp =
        options?.volumeProfile !== undefined
            ? options.volumeProfile
            : indicators.volumeProfile;
    const maPeriods =
        options?.maPeriods ?? Object.keys(indicators.ma).map(Number);
    const emaPeriods =
        options?.emaPeriods ?? Object.keys(indicators.ema).map(Number);

    const candidates: Array<LevelCandidate> = [
        ...(vp
            ? ([
                  [vp.poc, 'POC', 'vp_poc'],
                  [vp.vah, 'VAH', 'vp_vah'],
                  [vp.val, 'VAL', 'vp_val'],
              ] as const)
            : []),
        ...maPeriods.flatMap((period): Array<LevelCandidate> => {
            const series = indicators.ma[period];
            return series
                ? [[lastFiniteNumber(series), `MA${period}`, 'ma']]
                : [];
        }),
        ...emaPeriods.flatMap((period): Array<LevelCandidate> => {
            const series = indicators.ema[period];
            return series
                ? [[lastFiniteNumber(series), `EMA${period}`, 'ema']]
                : [];
        }),
        [
            lastField(indicators.bollinger, b => b.upper),
            'BB upper',
            'bollinger',
        ],
        [
            lastField(indicators.bollinger, b => b.lower),
            'BB lower',
            'bollinger',
        ],
        [
            lastField(indicators.keltnerChannel, k => k.upper),
            'Keltner upper',
            'keltner',
        ],
        [
            lastField(indicators.keltnerChannel, k => k.lower),
            'Keltner lower',
            'keltner',
        ],
        [
            lastField(indicators.donchianChannel, d => d.upper),
            'Donchian high',
            'donchian',
        ],
        [
            lastField(indicators.donchianChannel, d => d.lower),
            'Donchian low',
            'donchian',
        ],
        [lastField(indicators.ichimoku, i => i.senkouA), 'Kumo A', 'ichimoku'],
        [lastField(indicators.ichimoku, i => i.senkouB), 'Kumo B', 'ichimoku'],
        [
            lastField(indicators.supertrend, s => s.supertrend),
            'Supertrend',
            'supertrend',
        ],
        [lastFiniteNumber(indicators.vwap), 'VWAP', 'vwap'],
    ];

    return candidates
        .map(([price, label, kind]) =>
            toLevel(price, label, kind, currentPrice)
        )
        .filter((l): l is ReferenceLevel => l !== null);
}

/** @internal Split levels by side relative to price, dedupe near-equal, cap per side. */
export function splitBySide(
    levels: readonly ReferenceLevel[],
    currentPrice: number
): ReferenceLevels {
    const dedupe = (sorted: readonly ReferenceLevel[]): ReferenceLevel[] => {
        const kept: ReferenceLevel[] = [];
        for (const l of sorted) {
            const tolerance = DEDUPE_FRACTION * l.price;
            const isDuplicate = kept.some(
                k => Math.abs(k.price - l.price) <= tolerance
            );
            if (isDuplicate) continue;
            kept.push(l);
        }
        return kept.slice(0, MAX_REFERENCE_LEVELS_PER_SIDE);
    };
    const support = levels
        .filter(l => l.price < currentPrice)
        .toSorted((a, b) => b.price - a.price);
    const resistance = levels
        .filter(l => l.price > currentPrice)
        .toSorted((a, b) => a.price - b.price);
    return { support: dedupe(support), resistance: dedupe(resistance) };
}
