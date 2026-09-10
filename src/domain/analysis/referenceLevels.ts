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

/** Significant digits used to strip float noise from emitted round-number prices. */
const ROUND_PRICE_SIGNIFICANT_DIGITS = 12;

/** Prices inside [min, max] use the hand-picked USD tiers; outside it the step scales. */
const TIERED_ROUND_MIN_PRICE = 1;
const TIERED_ROUND_MAX_PRICE = 1_000;
/** Target round-number spacing as a fraction of price outside the tiered band. */
const SCALED_ROUND_STEP_FRACTION = 0.02;
/** Step multipliers per power of ten; the step is the smallest one at or above the target. */
const NICE_STEP_MULTIPLIERS = [1, 2.5, 5, 10] as const;

/** Smallest 1 / 2.5 / 5 × 10ⁿ step that is at least `target`. */
const niceStepAtLeast = (target: number): number => {
    const power = 10 ** Math.floor(Math.log10(target));
    // `10 × power` always clears a positive target, so find() always matches; the `??`
    // only satisfies the type checker (same pattern as the tier lookup below).
    const multiplier =
        NICE_STEP_MULTIPLIERS.find(m => m * power >= target) ??
        NICE_STEP_MULTIPLIERS[NICE_STEP_MULTIPLIERS.length - 1];
    return multiplier * power;
};

/**
 * Round-number spacing for a price.
 *
 * The tiers top out at a flat 10, which is right for a $300 stock and meaningless above
 * that: BTC at 77,107 got `Round 77110` 0.00% away and a KRX stock at 269,500 won got
 * `Round 269490` / `Round 269510`, which then became the nearest support and resistance.
 * Below one unit the 0.5 step produced nothing near the price at all. Outside the tiered
 * band the step therefore scales to ~2% of price (77,107 → 2,500; 269,500 → 10,000;
 * 0.0836 → 0.0025).
 */
const incrementFor = (price: number): number => {
    if (price < TIERED_ROUND_MIN_PRICE || price > TIERED_ROUND_MAX_PRICE) {
        return niceStepAtLeast(price * SCALED_ROUND_STEP_FRACTION);
    }
    // The final tier's ceiling is +Infinity, so find() always matches; the `??`
    // only satisfies the type checker and reuses that tier's increment (no second
    // source of truth for the top-tier value).
    return (
        ROUND_NUMBER_TIERS.find(t => price <= t.maxPrice) ??
        ROUND_NUMBER_TIERS[ROUND_NUMBER_TIERS.length - 1]
    ).increment;
};

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
        const price = Number(
            (base + i * inc).toPrecision(ROUND_PRICE_SIGNIFICANT_DIGITS)
        );
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
        // `as const` keeps each `kind` string at its `ReferenceLevelKind` literal
        // type (instead of widening to `string`) so the tuples match `LevelCandidate`;
        // runtime-safe — the values are plain literals.
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
