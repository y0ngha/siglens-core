import type { Bar, DonchianChannelResult } from '@/domain/types';
import { DONCHIAN_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import { slidingMax, slidingMin } from '@/domain/indicators/utils';

export function calculateDonchianChannel(
    bars: Bar[],
    period = DONCHIAN_DEFAULT_PERIOD
): DonchianChannelResult[] {
    if (bars.length === 0) return [];
    if (bars.length < period)
        return bars.map(() => ({ upper: null, middle: null, lower: null }));

    const winMax = slidingMax(
        bars.map(b => b.high),
        period
    );
    const winMin = slidingMin(
        bars.map(b => b.low),
        period
    );

    return bars.map((_, i) => {
        if (i < period - 1) return { upper: null, middle: null, lower: null };
        const upper = winMax[i]!;
        const lower = winMin[i]!;
        return { upper, middle: (upper + lower) / 2, lower };
    });
}
