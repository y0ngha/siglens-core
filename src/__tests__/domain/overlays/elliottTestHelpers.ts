import type { PivotPoint } from '@/domain/types';
import { makeBars } from '@/__tests__/domain/patterns/helpers';

/** Prompt-line format shared by the Elliott structure tests. */
export const FMT = {
    timeframe: '1Day' as const,
    quoting: { dp: 2, krxTick: null },
};
/** Default bars between consecutive pivots in `pivotsAt`. */
export const STEP = 4;

/**
 * Alternating pivots at `prices`, STEP bars apart unless `at` gives each
 * pivot's bar. Bars only supply times here (time = index).
 */
export function pivotsAt(prices: number[], at?: number[]) {
    const pivots: PivotPoint[] = prices.map((price, i) => ({
        index: at?.[i] ?? i * STEP,
        price,
        kind: (i === 0 ? price > prices[1] : price > prices[i - 1])
            ? 'high'
            : 'low',
    }));
    const bars = makeBars(
        Array.from({ length: pivots[pivots.length - 1].index + 1 }, () => 100)
    );
    return { pivots, bars };
}
