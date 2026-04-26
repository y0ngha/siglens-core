import {
    ISO_DATE_HOUR_PREFIX_LENGTH,
    ISO_DATE_PREFIX_LENGTH,
} from '@/domain/constants/format';
import { MS_PER_DAY } from '@/domain/constants/time';
import { calculateIndicators } from '@/domain/indicators';
import { classifyTrend, detectSignals } from '@/domain/signals';
import type {
    Bar,
    DashboardTimeframe,
    MarketQuote,
    SectorStock,
    StockSignalResult,
} from '@/domain/types';

const FIFTEEN_MIN_BUCKET = 15;
const MIN_BARS_FOR_PERCENT_CHANGE = 2;
const PERCENT_FACTOR = 100;

const LOOKBACK_DAYS_BY_TIMEFRAME: Record<DashboardTimeframe, number> = {
    // 일봉: 약 1.5년치 (지표 워밍업 + SMC 룩백 여유)
    '1Day': 400,
    // 시봉: 약 5주치 (squeeze lookback 120봉 + 트레이딩 시간 고려)
    '1Hour': 40,
    // 15분봉: 약 10일치 (시장 시간 기준 ~5거래일)
    '15Min': 10,
};

export function bucketedTimestamp(
    timeframe: DashboardTimeframe,
    now: Date
): string {
    const iso = now.toISOString();
    if (timeframe === '1Day') return iso.slice(0, ISO_DATE_PREFIX_LENGTH);
    if (timeframe === '1Hour') return iso.slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const minutes = now.getUTCMinutes();
    const bucketMin =
        Math.floor(minutes / FIFTEEN_MIN_BUCKET) * FIFTEEN_MIN_BUCKET;
    const minStr = bucketMin.toString().padStart(2, '0');
    return `${iso.slice(0, ISO_DATE_HOUR_PREFIX_LENGTH)}:${minStr}`;
}

export function lookbackIsoFromNow(
    timeframe: DashboardTimeframe,
    now: Date
): string {
    const msToSubtract = LOOKBACK_DAYS_BY_TIMEFRAME[timeframe] * MS_PER_DAY;
    return new Date(now.getTime() - msToSubtract).toISOString();
}

export function computeStockSignalResult(
    stock: SectorStock,
    bars: Bar[],
    quote: MarketQuote | null
): StockSignalResult | null {
    if (bars.length < MIN_BARS_FOR_PERCENT_CHANGE) return null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];

    const indicators = calculateIndicators(bars);
    const signals = detectSignals(bars, indicators);
    if (signals.length === 0) return null;

    const trend = classifyTrend(bars, indicators);
    const price = quote?.price ?? last.close;
    const changePercent =
        quote?.changesPercentage ??
        (prev.close === 0
            ? 0
            : ((last.close - prev.close) / prev.close) * PERCENT_FACTOR);

    return {
        symbol: stock.symbol,
        koreanName: stock.koreanName,
        sectorSymbol: stock.sectorSymbol,
        price,
        changePercent,
        trend,
        signals,
    };
}
