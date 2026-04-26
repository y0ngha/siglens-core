import type { Bar, IchimokuFuturePoint, IchimokuResult } from '@/domain/types';
import {
    ICHIMOKU_BASE_PERIOD,
    ICHIMOKU_CONVERSION_PERIOD,
    ICHIMOKU_DISPLACEMENT,
    ICHIMOKU_SPAN_B_PERIOD,
} from '@/domain/indicators/constants';
import { slidingMax, slidingMin } from '@/domain/indicators/utils';

function midpointAt(
    maxH: (number | null)[],
    minL: (number | null)[],
    idx: number
): number | null {
    if (idx < 0) return null;
    const h = maxH[idx];
    const l = minL[idx];
    return h != null && l != null ? (h + l) / 2 : null;
}

export function calculateIchimoku(
    bars: Bar[],
    conversionPeriod = ICHIMOKU_CONVERSION_PERIOD,
    basePeriod = ICHIMOKU_BASE_PERIOD,
    spanBPeriod = ICHIMOKU_SPAN_B_PERIOD,
    displacement = ICHIMOKU_DISPLACEMENT
): IchimokuResult[] {
    if (bars.length === 0) return [];

    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);

    const convMaxH = slidingMax(highs, conversionPeriod);
    const convMinL = slidingMin(lows, conversionPeriod);
    const baseMaxH = slidingMax(highs, basePeriod);
    const baseMinL = slidingMin(lows, basePeriod);
    const spanBMaxH = slidingMax(highs, spanBPeriod);
    const spanBMinL = slidingMin(lows, spanBPeriod);

    return bars.map((_, i) => {
        const tenkan = midpointAt(convMaxH, convMinL, i);
        const kijun = midpointAt(baseMaxH, baseMinL, i);

        const sourceIndex = i - displacement;
        let senkouA: number | null = null;
        let senkouB: number | null = null;
        if (sourceIndex >= 0) {
            const t = midpointAt(convMaxH, convMinL, sourceIndex);
            const k = midpointAt(baseMaxH, baseMinL, sourceIndex);
            senkouA = t !== null && k !== null ? (t + k) / 2 : null;
            senkouB = midpointAt(spanBMaxH, spanBMinL, sourceIndex);
        }

        const chikouIndex = i + displacement;
        const chikou =
            chikouIndex < bars.length ? bars[chikouIndex].close : null;

        return { tenkan, kijun, senkouA, senkouB, chikou };
    });
}

// Returns senkou A/B for displacement bars into the future per standard Ichimoku spec.
export function calculateIchimokuFutureCloud(
    bars: Bar[],
    conversionPeriod = ICHIMOKU_CONVERSION_PERIOD,
    basePeriod = ICHIMOKU_BASE_PERIOD,
    spanBPeriod = ICHIMOKU_SPAN_B_PERIOD,
    displacement = ICHIMOKU_DISPLACEMENT
): IchimokuFuturePoint[] {
    if (bars.length === 0) return [];

    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);

    const convMaxH = slidingMax(highs, conversionPeriod);
    const convMinL = slidingMin(lows, conversionPeriod);
    const baseMaxH = slidingMax(highs, basePeriod);
    const baseMinL = slidingMin(lows, basePeriod);
    const spanBMaxH = slidingMax(highs, spanBPeriod);
    const spanBMinL = slidingMin(lows, spanBPeriod);

    return Array.from({ length: displacement }, (_, j) => {
        const sourceIndex = bars.length - displacement + j;
        const t = midpointAt(convMaxH, convMinL, sourceIndex);
        const k = midpointAt(baseMaxH, baseMinL, sourceIndex);
        const senkouA = t !== null && k !== null ? (t + k) / 2 : null;
        const senkouB = midpointAt(spanBMaxH, spanBMinL, sourceIndex);
        return { senkouA, senkouB };
    });
}
