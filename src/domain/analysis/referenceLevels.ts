import type {
    IndicatorResult,
    ReferenceLevel,
    ReferenceLevels,
    VolumeProfileResult,
} from '@/domain/types';
import {
    MAX_REFERENCE_LEVELS_PER_SIDE,
    ROUND_NUMBER_TIERS,
} from '@/domain/analysis/marketReferenceConstants';

/** Number of round levels to emit on each side of price. */
const ROUND_LEVELS_PER_SIDE = 2;

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
    for (let i = -ROUND_LEVELS_PER_SIDE; i <= ROUND_LEVELS_PER_SIDE + 1; i++) {
        const price = Number((base + i * inc).toFixed(ROUND_PRICE_PRECISION));
        if (price <= 0) continue;
        levels.push({
            price,
            label: roundLabel(price),
            kind: 'round',
            distancePercent: ((price - currentPrice) / currentPrice) * 100,
        });
    }
    return levels;
}

/** Fraction of price within which two levels are treated as duplicates (0.1%). */
const DEDUPE_FRACTION = 0.001;

const lastNum = (arr: readonly (number | null)[]): number | null => {
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

const ref = (
    price: number,
    label: string,
    kind: ReferenceLevel['kind'],
    currentPrice: number
): ReferenceLevel => ({
    price,
    label,
    kind,
    distancePercent: ((price - currentPrice) / currentPrice) * 100,
});

/** @internal Optional per-horizon overrides for indicator level collection. */
export interface IndicatorLevelOptions {
    /** Volume profile to use (e.g. a window-local recompute). Defaults to indicators.volumeProfile. */
    volumeProfile?: VolumeProfileResult | null;
    /** MA periods to include (defaults to all present). */
    maPeriods?: readonly number[];
    /** EMA periods to include (defaults to all present). */
    emaPeriods?: readonly number[];
}

/** @internal Latest-value reference levels from the indicator suite. */
export function collectIndicatorLevels(
    currentPrice: number,
    indicators: IndicatorResult,
    options?: IndicatorLevelOptions
): ReferenceLevel[] {
    const out: ReferenceLevel[] = [];
    const push = (
        price: number | null,
        label: string,
        kind: ReferenceLevel['kind']
    ): void => {
        if (price != null && Number.isFinite(price) && price > 0) {
            out.push(ref(price, label, kind, currentPrice));
        }
    };

    const vp =
        options?.volumeProfile !== undefined
            ? options.volumeProfile
            : indicators.volumeProfile;
    if (vp) {
        push(vp.poc, 'POC', 'vp_poc');
        push(vp.vah, 'VAH', 'vp_vah');
        push(vp.val, 'VAL', 'vp_val');
    }
    const maPeriods =
        options?.maPeriods ?? Object.keys(indicators.ma).map(Number);
    for (const period of maPeriods) {
        const series = indicators.ma[period];
        if (series) push(lastNum(series), `MA${period}`, 'ma');
    }
    const emaPeriods =
        options?.emaPeriods ?? Object.keys(indicators.ema).map(Number);
    for (const period of emaPeriods) {
        const series = indicators.ema[period];
        if (series) push(lastNum(series), `EMA${period}`, 'ema');
    }
    push(
        lastField(indicators.bollinger, b => b.upper),
        'BB upper',
        'bollinger'
    );
    push(
        lastField(indicators.bollinger, b => b.lower),
        'BB lower',
        'bollinger'
    );
    push(
        lastField(indicators.keltnerChannel, k => k.upper),
        'Keltner upper',
        'keltner'
    );
    push(
        lastField(indicators.keltnerChannel, k => k.lower),
        'Keltner lower',
        'keltner'
    );
    push(
        lastField(indicators.donchianChannel, d => d.upper),
        'Donchian high',
        'donchian'
    );
    push(
        lastField(indicators.donchianChannel, d => d.lower),
        'Donchian low',
        'donchian'
    );
    push(
        lastField(indicators.ichimoku, i => i.senkouA),
        'Kumo A',
        'ichimoku'
    );
    push(
        lastField(indicators.ichimoku, i => i.senkouB),
        'Kumo B',
        'ichimoku'
    );
    push(
        lastField(indicators.supertrend, s => s.supertrend),
        'Supertrend',
        'supertrend'
    );
    push(lastNum(indicators.vwap), 'VWAP', 'vwap');
    return out;
}

/** @internal Split levels by side relative to price, dedupe near-equal, cap per side. */
export function splitBySide(
    levels: readonly ReferenceLevel[],
    currentPrice: number
): ReferenceLevels {
    const dedupe = (sorted: readonly ReferenceLevel[]): ReferenceLevel[] => {
        const kept: ReferenceLevel[] = [];
        for (const l of sorted) {
            const isDuplicate = kept.some(
                k => Math.abs(k.price - l.price) <= DEDUPE_FRACTION * l.price
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
