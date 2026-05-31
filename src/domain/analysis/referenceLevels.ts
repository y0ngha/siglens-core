import type { ReferenceLevel } from '@/domain/types';
import { ROUND_NUMBER_TIERS } from '@/domain/analysis/marketReferenceConstants';

/** Number of round levels to emit on each side of price. */
const ROUND_LEVELS_PER_SIDE = 2;

/** Decimal places used to normalize emitted round-number prices. */
const ROUND_PRICE_PRECISION = 4;

/** Fallback increment when price exceeds every configured tier ceiling. */
const FALLBACK_INCREMENT = 10;

const incrementFor = (price: number): number =>
    ROUND_NUMBER_TIERS.find(t => price <= t.maxPrice)?.increment ??
    FALLBACK_INCREMENT;

const roundLabel = (price: number): string => `Round ${price}`;

/** Nearest round-number levels above and below the price (advisory psychology). */
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
