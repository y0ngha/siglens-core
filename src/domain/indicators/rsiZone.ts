import {
    RSI_OVERBOUGHT_LEVEL,
    RSI_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';

export type RsiZone = 'overbought' | 'neutral' | 'oversold';

/**
 * Classifies an RSI value: overbought at or above {@link RSI_OVERBOUGHT_LEVEL},
 * oversold at or below {@link RSI_OVERSOLD_LEVEL}, neutral in between. Shared
 * by the analysis prompt and consumers (chart labels, agent tool results) so
 * every surface names the same zone for the same value.
 */
export function rsiZone(rsi: number): RsiZone {
    if (rsi >= RSI_OVERBOUGHT_LEVEL) return 'overbought';
    if (rsi <= RSI_OVERSOLD_LEVEL) return 'oversold';
    return 'neutral';
}
