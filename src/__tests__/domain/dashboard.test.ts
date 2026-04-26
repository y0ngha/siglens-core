import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    Bar,
    IndicatorResult,
    MarketQuote,
    SectorStock,
    Signal,
    TrendState,
} from '@/domain/types';

const detectSignalsMock =
    vi.fn<(bars: Bar[], indicators: IndicatorResult) => readonly Signal[]>();
const classifyTrendMock =
    vi.fn<(bars: Bar[], indicators: IndicatorResult) => TrendState>();

vi.mock('@/domain/signals', () => ({
    detectSignals: (bars: Bar[], indicators: IndicatorResult) =>
        detectSignalsMock(bars, indicators),
    classifyTrend: (bars: Bar[], indicators: IndicatorResult) =>
        classifyTrendMock(bars, indicators),
}));

import {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from '@/domain/dashboard';

describe('bucketedTimestamp', () => {
    const now = new Date('2026-04-25T13:48:00.000Z');

    it('1Day → YYYY-MM-DD', () => {
        expect(bucketedTimestamp('1Day', now)).toBe('2026-04-25');
    });

    it('1Hour → YYYY-MM-DDTHH', () => {
        expect(bucketedTimestamp('1Hour', now)).toBe('2026-04-25T13');
    });

    it('15Min: 분을 15분 단위로 floor', () => {
        expect(bucketedTimestamp('15Min', now)).toBe('2026-04-25T13:45');
    });

    it('15Min: 0~14분은 :00 버킷', () => {
        const exact = new Date('2026-04-25T13:00:00.000Z');
        const within = new Date('2026-04-25T13:14:59.000Z');
        expect(bucketedTimestamp('15Min', exact)).toBe('2026-04-25T13:00');
        expect(bucketedTimestamp('15Min', within)).toBe('2026-04-25T13:00');
    });
});

describe('lookbackIsoFromNow', () => {
    const MS_PER_DAY = 86_400_000;

    it('1Day 는 약 400일 전 ISO 반환', () => {
        const now = new Date('2026-04-25T00:00:00.000Z');
        const iso = lookbackIsoFromNow('1Day', now);
        const diffDays = (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY;
        expect(Math.round(diffDays)).toBe(400);
    });

    it('1Hour 는 40일 전 ISO 반환', () => {
        const now = new Date('2026-04-25T00:00:00.000Z');
        const iso = lookbackIsoFromNow('1Hour', now);
        const diffDays = (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY;
        expect(Math.round(diffDays)).toBe(40);
    });

    it('15Min 은 10일 전 ISO 반환', () => {
        const now = new Date('2026-04-25T00:00:00.000Z');
        const iso = lookbackIsoFromNow('15Min', now);
        const diffDays = (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY;
        expect(Math.round(diffDays)).toBe(10);
    });
});

const stock: SectorStock = {
    symbol: 'AAPL',
    koreanName: '애플',
    sectorSymbol: 'XLK',
};

function makeBar(close: number, prevClose: number): Bar[] {
    return [
        {
            time: 0,
            open: prevClose,
            high: prevClose,
            low: prevClose,
            close: prevClose,
            volume: 100,
        },
        { time: 1, open: close, high: close, low: close, close, volume: 100 },
    ];
}

const stubSignal: Signal = {
    type: 'rsi_oversold',
    direction: 'bullish',
    phase: 'confirmed',
    detectedAt: 0,
};

beforeEach(() => {
    detectSignalsMock.mockReset();
    classifyTrendMock.mockReset();
    classifyTrendMock.mockReturnValue('sideways');
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('computeStockSignalResult', () => {
    it('bar 가 2개 미만이면 null', () => {
        const bars: Bar[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ];
        detectSignalsMock.mockReturnValue([stubSignal]);
        expect(computeStockSignalResult(stock, bars, null)).toBeNull();
    });

    it('signal 이 0개이면 null', () => {
        detectSignalsMock.mockReturnValue([]);
        const bars = makeBar(100, 100);
        expect(computeStockSignalResult(stock, bars, null)).toBeNull();
    });

    it('signal 이 있고 quote 가 없으면 last.close 와 계산된 changePercent 반환', () => {
        detectSignalsMock.mockReturnValue([stubSignal]);
        classifyTrendMock.mockReturnValue('uptrend');
        const bars = makeBar(110, 100); // +10%

        const result = computeStockSignalResult(stock, bars, null);
        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            symbol: 'AAPL',
            koreanName: '애플',
            sectorSymbol: 'XLK',
            price: 110,
            trend: 'uptrend',
            signals: [stubSignal],
        });
        expect(result?.changePercent).toBeCloseTo(10);
    });

    it('signal 이 있고 quote 가 있으면 quote 의 price/changesPercentage 우선', () => {
        detectSignalsMock.mockReturnValue([stubSignal]);
        const bars = makeBar(110, 100);
        const quote: MarketQuote = {
            symbol: 'AAPL',
            price: 150,
            changesPercentage: 1.5,
            name: 'Apple',
        };

        const result = computeStockSignalResult(stock, bars, quote);
        expect(result).toMatchObject({ price: 150, changePercent: 1.5 });
    });

    it('prev.close === 0 인 경우 changePercent 는 0', () => {
        detectSignalsMock.mockReturnValue([stubSignal]);
        const bars = makeBar(100, 0);

        const result = computeStockSignalResult(stock, bars, null);
        expect(result?.changePercent).toBe(0);
        expect(result?.price).toBe(100);
    });
});
