import type { Bar, DonchianChannelResult } from '@/domain/types';
import { DONCHIAN_DEFAULT_PERIOD } from '@/domain/indicators/constants';

export function calculateDonchianChannel(
    bars: Bar[],
    period = DONCHIAN_DEFAULT_PERIOD
): DonchianChannelResult[] {
    if (bars.length === 0) return [];
    if (bars.length < period)
        return bars.map(() => ({ upper: null, middle: null, lower: null }));

    const result: DonchianChannelResult[] = [];

    for (let i = 0; i < bars.length; i++) {
        if (i < period - 1) {
            result.push({ upper: null, middle: null, lower: null });
            continue;
        }
        let upper = -Infinity;
        let lower = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            if (bars[j].high > upper) upper = bars[j].high;
            if (bars[j].low < lower) lower = bars[j].low;
        }
        result.push({ upper, middle: (upper + lower) / 2, lower });
    }

    return result;
}
