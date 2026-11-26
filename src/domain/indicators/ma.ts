import type { Bar } from '@/domain/types';

/**
 * Simple moving average of bar closes for a given period.
 *
 * @param bars - Bars oldest-first.
 * @param period - Number of closes averaged.
 * @returns One value per bar, `null` until `period` closes exist; `[]` for no bars or `period <= 0`.
 */
export function calculateMA(bars: Bar[], period: number): (number | null)[] {
    if (bars.length === 0 || period <= 0) return [];

    const closes = bars.map(bar => bar.close);

    if (closes.length < period) {
        return closes.map(() => null);
    }

    const nulls: (number | null)[] = new Array(period - 1).fill(null);

    let windowSum = closes.slice(0, period).reduce((s, c) => s + c, 0);
    const smas: (number | null)[] = [windowSum / period];
    for (let i = period; i < closes.length; i++) {
        windowSum += closes[i] - closes[i - period];
        smas.push(windowSum / period);
    }

    return [...nulls, ...smas];
}
