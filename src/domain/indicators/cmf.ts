import type { Bar } from '@/domain/types';
import { CMF_DEFAULT_PERIOD } from '@/domain/indicators/constants';

function clv(bar: Bar): number {
    const range = bar.high - bar.low;
    if (range === 0) return 0;
    return (bar.close - bar.low - (bar.high - bar.close)) / range;
}

export function calculateCMF(
    bars: Bar[],
    period = CMF_DEFAULT_PERIOD
): (number | null)[] {
    if (bars.length === 0) return [];
    if (bars.length < period) return bars.map(() => null);

    const mfVolumes = bars.map(bar => clv(bar) * bar.volume);
    const volumes = bars.map(bar => bar.volume);

    const result: (number | null)[] = [];
    let mfvWindowSum = 0;
    let volWindowSum = 0;

    for (let i = 0; i < bars.length; i++) {
        mfvWindowSum += mfVolumes[i];
        volWindowSum += volumes[i];
        if (i >= period) {
            mfvWindowSum -= mfVolumes[i - period];
            volWindowSum -= volumes[i - period];
        }
        if (i < period - 1) {
            result.push(null);
            continue;
        }
        result.push(volWindowSum === 0 ? 0 : mfvWindowSum / volWindowSum);
    }

    return result;
}
