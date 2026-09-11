import {
    MAX_REFERENCE_LEVELS_PER_SIDE,
    RATIO_TO_PERCENT,
} from '@/domain/analysis/marketReferenceConstants';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type {
    Bar,
    IndicatorLevelOptions,
    IndicatorResult,
    ReferenceLevel,
    ReferenceLevels,
} from '@/domain/types';

/** Number of round levels to emit on each side of price. */
const ROUND_LEVELS_PER_SIDE = 2;

/** Extra candidate above base so the resistance side keeps >= ROUND_LEVELS_PER_SIDE levels. */
const ROUND_LEVELS_UPPER_EXTRA = 1;

/** Significant digits used to strip float noise from emitted round-number prices. */
const ROUND_PRICE_SIGNIFICANT_DIGITS = 12;

/** Target round-number spacing as a fraction of price. */
const ROUND_STEP_FRACTION = 0.02;
/** Step multipliers per power of ten; the step is the smallest one at or above the target. */
const NICE_STEP_MULTIPLIERS = [1, 2.5, 5, 10] as const;

/**
 * Round-number spacing for a price: the smallest 1 / 2.5 / 5 × 10ⁿ step that is at least
 * 2% of it (77,107 → 2,500; 269,500 → 10,000; 320 → 10; 4 → 0.1; 0.0836 → 0.0025).
 *
 * One continuous rule at every magnitude. A hand-picked USD tier table used to cover
 * 1–1,000 with the scaled rule outside it, and the seams jumped: 0.99 stepped 0.025 while
 * 1.00 stepped 0.5 (20×), and 1,000 stepped 10 while 1,000.01 stepped 25. Before the scaled
 * rule existed the flat top tier of 10 put `Round 77110` 0.00% from BTC and `Round 269490`
 * / `Round 269510` around a KRX stock, which then became its nearest support and resistance.
 */
const incrementFor = (price: number): number => {
    const target = price * ROUND_STEP_FRACTION;
    const power = 10 ** Math.floor(Math.log10(target));
    // `10 × power` always clears a positive target, so find() always matches; the `??`
    // only satisfies the type checker.
    const multiplier =
        NICE_STEP_MULTIPLIERS.find(m => m * power >= target) ??
        NICE_STEP_MULTIPLIERS[NICE_STEP_MULTIPLIERS.length - 1];
    return multiplier * power;
};

/**
 * `Round <price>` in plain decimal notation at the step's own precision.
 *
 * `String(price)` switches to exponent form below `1e-6` (`Round 1.25e-7`), which the model
 * cannot line up with the bar prices printed a few sections earlier.
 */
const roundLabel = (price: number, inc: number): string => {
    const exponent = Math.floor(Math.log10(inc));
    const mantissaIsWhole = Number.isInteger(
        Number(
            (inc / 10 ** exponent).toPrecision(ROUND_PRICE_SIGNIFICANT_DIGITS)
        )
    );
    const dp = Math.max(0, -exponent + (mantissaIsWhole ? 0 : 1));
    return `Round ${price.toFixed(dp)}`;
};

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
            label: roundLabel(price, inc),
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

/**
 * @internal
 * Share of the recent mean bar range inside which a level counts as "at price".
 *
 * On real charts the nearest level was routinely one the price was already touching: a
 * 15-minute NVDA chart rendered `Pivot PP … (-0.00%)` and a risk:reward of 180.38, a 5-won
 * KRX round number gave exactly 1.00, and hourly AAPL paired a 0.06% "resistance" with a
 * 0.01% "support". A level closer than half an ordinary bar's range is crossed by the next
 * bar either way, so it can serve neither as a stop nor as a target.
 */
export const AT_PRICE_BAR_RANGE_FRACTION = 0.5;

/** At-price levels kept per side on top of the regular cap — context, not candidates. */
const MAX_AT_PRICE_LEVELS_PER_SIDE = 2;

/**
 * @internal
 * Mean high–low range of the last {@link ATR_DEFAULT_PERIOD} bars, in percent of close, or
 * `0` when no bar is usable.
 */
export function meanBarRangePercent(bars: readonly Bar[]): number {
    const ranges = bars
        .slice(-ATR_DEFAULT_PERIOD)
        .filter(b => b.close > 0 && b.high >= b.low)
        .map(b => ((b.high - b.low) / b.close) * RATIO_TO_PERCENT);
    if (ranges.length === 0) return 0;
    return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

/**
 * @internal
 * Split levels by side relative to price, dedupe near-equal, flag at-price levels, cap per
 * side.
 *
 * The cap applies to levels **beyond** `atPriceBandPercent`; at-price levels are kept
 * separately (at most {@link MAX_AT_PRICE_LEVELS_PER_SIDE}, flagged `atPrice`). Capping
 * first used to let a cluster of at-price levels fill all six slots, and the risk:reward
 * block — which skips at-price levels — then found nothing on that side and silently
 * disappeared.
 *
 * @param atPriceBandPercent - Distance, in percent of price, inside which a level is at
 *   price. `0` (the default) flags nothing and reproduces the plain six-per-side cap.
 */
export function splitBySide(
    levels: readonly ReferenceLevel[],
    currentPrice: number,
    atPriceBandPercent = 0
): ReferenceLevels {
    const side = (sorted: readonly ReferenceLevel[]): ReferenceLevel[] => {
        const kept: ReferenceLevel[] = [];
        for (const l of sorted) {
            const tolerance = DEDUPE_FRACTION * l.price;
            const isDuplicate = kept.some(
                k => Math.abs(k.price - l.price) <= tolerance
            );
            if (isDuplicate) continue;
            kept.push(l);
        }
        const isAtPrice = (l: ReferenceLevel): boolean =>
            Math.abs(l.distancePercent) < atPriceBandPercent;
        return [
            ...kept
                .filter(isAtPrice)
                .slice(0, MAX_AT_PRICE_LEVELS_PER_SIDE)
                .map(l => ({ ...l, atPrice: true as const })),
            ...kept
                .filter(l => !isAtPrice(l))
                .slice(0, MAX_REFERENCE_LEVELS_PER_SIDE),
        ];
    };
    const support = levels
        .filter(l => l.price < currentPrice)
        .toSorted((a, b) => b.price - a.price);
    const resistance = levels
        .filter(l => l.price > currentPrice)
        .toSorted((a, b) => a.price - b.price);
    return { support: side(support), resistance: side(resistance) };
}
