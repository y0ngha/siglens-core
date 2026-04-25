import { calculateIndicators } from '@/domain/indicators';
import type { BarsData, Timeframe } from '@/domain/types';
import {
    TIMEFRAME_BARS_LIMIT,
    TIMEFRAME_LOOKBACK_DAYS,
} from '@/domain/constants/market';
import { createMarketDataProvider } from '@/infrastructure/market/factory';

function computeFromDay(timeframe: Timeframe, now: Date): string {
    const lookbackDays = TIMEFRAME_LOOKBACK_DAYS[timeframe];
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - lookbackDays);
    return from.toISOString().substring(0, 10) + 'T00:00:00Z';
}

export async function fetchBarsWithIndicators(
    symbol: string,
    timeframe: Timeframe,
    fmpSymbol?: string
): Promise<BarsData> {
    const fromDay = computeFromDay(timeframe, new Date());
    const limit = TIMEFRAME_BARS_LIMIT[timeframe];
    const provider = createMarketDataProvider();
    const bars = await provider.getBars({
        symbol: fmpSymbol ?? symbol,
        timeframe,
        limit,
        from: fromDay,
    });

    const indicators = calculateIndicators(bars);
    return { bars, indicators };
}
