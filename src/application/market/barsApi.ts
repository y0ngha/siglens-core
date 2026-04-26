import { calculateIndicators } from '@/domain/indicators';
import type { BarsData, Timeframe } from '@/domain/types';
import {
    TIMEFRAME_BARS_LIMIT,
    TIMEFRAME_LOOKBACK_DAYS,
} from '@/domain/constants/market';
import { ISO_DATE_PREFIX_LENGTH } from '@/domain/constants/format';
import { createMarketDataProvider } from '@/infrastructure/market/factory';

function computeFromDay(timeframe: Timeframe, now: Date): string {
    const lookbackDays = TIMEFRAME_LOOKBACK_DAYS[timeframe];
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - lookbackDays);
    return (
        from.toISOString().substring(0, ISO_DATE_PREFIX_LENGTH) + 'T00:00:00Z'
    );
}

export async function fetchBarsWithIndicators(
    symbol: string,
    timeframe: Timeframe,
    fmpSymbol?: string,
    now = new Date()
): Promise<BarsData> {
    const fromDay = computeFromDay(timeframe, now);
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
