import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    Bar,
    MarketQuote,
    SectorSignalsResult,
    SectorStock,
    StockSignalResult,
} from '@/domain/types';
import type { CacheProvider } from '@/domain/ports/cache';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const mockCache: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
} = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
};

const createCacheProviderMock = vi.fn<() => CacheProvider | null>();
const mockGetQuote = vi.fn<(s: string) => Promise<MarketQuote | null>>();
const mockGetBars = vi.fn<() => Promise<Bar[]>>();

vi.mock('@/infrastructure/cache/redis', () => ({
    createCacheProvider: () => createCacheProviderMock(),
}));

// combineResults 의 분기(라인 79/83/90)를 결정적으로 구동하기 위해
// computeStockSignalResult 만 스텁하고, 실제 흐름이 의존하는
// bucketedTimestamp / lookbackIsoFromNow 는 실제 구현을 유지한다.
const computeStockSignalResultMock =
    vi.fn<
        (
            stock: SectorStock,
            bars: Bar[],
            quote: MarketQuote | null
        ) => StockSignalResult | null
    >();

vi.mock('@/domain/dashboard', async importActual => {
    const actual = await importActual<typeof import('@/domain/dashboard')>();
    return {
        ...actual,
        computeStockSignalResult: (
            stock: SectorStock,
            bars: Bar[],
            quote: MarketQuote | null
        ) => computeStockSignalResultMock(stock, bars, quote),
    };
});

const fakeProvider: MarketDataProvider = {
    getQuote: mockGetQuote,
    getBars: mockGetBars,
};

import { getSectorSignals } from '@/application/dashboard/sectorSignals';

const fixedNow = new Date('2026-04-25T13:48:00.000Z');

// 캐시 write 분기(stocks.length > 0)를 구동하기 위한 non-empty 신호 결과.
const nonEmptySignal: StockSignalResult = {
    symbol: 'AAPL',
    koreanName: '애플',
    sectorSymbol: 'XLK',
    price: 150,
    changePercent: 1.5,
    trend: 'uptrend',
    signals: [],
};

describe('getSectorSignals', () => {
    beforeEach(() => {
        mockCache.get.mockReset();
        mockCache.set.mockReset();
        mockCache.set.mockResolvedValue(undefined);
        createCacheProviderMock.mockReset();
        createCacheProviderMock.mockReturnValue(mockCache);
        mockGetQuote.mockReset();
        mockGetQuote.mockResolvedValue(null);
        mockGetBars.mockReset();
        mockGetBars.mockResolvedValue([]);
        computeStockSignalResultMock.mockReset();
        // 기본: bar 가 비어 있어 신호가 없으므로 결과는 null (line 90 의 [] 경로).
        computeStockSignalResultMock.mockReturnValue(null);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('cache hit 시 cached payload 를 반환한다', async () => {
        const cached: SectorSignalsResult = {
            computedAt: fixedNow.toISOString(),
            stocks: [],
        };
        mockCache.get.mockResolvedValue(cached);

        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result).toBe(cached);
        expect(mockGetBars).not.toHaveBeenCalled();
    });

    it('cache miss + non-empty stocks 시 provider fetch 후 결과를 캐시에 저장한다', async () => {
        mockCache.get.mockResolvedValue(null);
        computeStockSignalResultMock.mockReturnValue(nonEmptySignal);

        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.computedAt).toBe(fixedNow.toISOString());
        expect(result.stocks.length).toBeGreaterThan(0);
        expect(mockCache.set).toHaveBeenCalledTimes(1);
        const [key, payload, ttl] = mockCache.set.mock.calls[0];
        expect(key).toMatch(/^dashboard:signals:1Day:/);
        expect(payload).toEqual(result);
        expect(typeof ttl).toBe('number');
    });

    it('stocks 가 빈 배열이면 캐시에 저장하지 않는다 (poison 방지)', async () => {
        mockCache.get.mockResolvedValue(null);
        // 기본 setup: computeStockSignalResult → null → stocks=[] (fetch는 성공·빈 배열).
        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.stocks).toEqual([]);
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('cache provider 가 null 이어도 정상 동작', async () => {
        createCacheProviderMock.mockReturnValue(null);
        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.stocks).toEqual([]);
    });

    it('cache get 실패는 무시하고 provider 로 fallthrough', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.stocks).toEqual([]);
    });

    it('cache set 실패는 호출자에게 전파되지 않는다', async () => {
        mockCache.get.mockResolvedValue(null);
        computeStockSignalResultMock.mockReturnValue(nonEmptySignal);
        mockCache.set.mockRejectedValue(new Error('cache write down'));
        await expect(
            getSectorSignals(fakeProvider, '1Day', fixedNow)
        ).resolves.toBeDefined();
    });

    it('default timeframe 은 1Day', async () => {
        mockCache.get.mockResolvedValue(null);
        computeStockSignalResultMock.mockReturnValue(nonEmptySignal);
        await getSectorSignals(fakeProvider, undefined, fixedNow);
        const [key] = mockCache.set.mock.calls[0];
        expect(key).toMatch(/^dashboard:signals:1Day:/);
    });

    it('getBars 가 reject 된 ticker 는 결과에서 제외된다', async () => {
        mockCache.get.mockResolvedValue(null);
        // 첫 ticker(AAPL)의 getBars 만 reject → combineResults line 79 의 drop 경로.
        mockGetBars.mockReset();
        mockGetBars.mockRejectedValueOnce(new Error('bars down'));
        mockGetBars.mockResolvedValue([]);
        // 신호 계산이 호출되더라도 결과를 만들지 않도록 null 유지.
        computeStockSignalResultMock.mockReturnValue(null);

        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);

        expect(result.stocks).toEqual([]);
        // reject 된 ticker 는 computeStockSignalResult 에 전달되지 않는다.
        const calledSymbols = computeStockSignalResultMock.mock.calls.map(
            ([stock]) => (stock as { symbol: string }).symbol
        );
        expect(calledSymbols).not.toContain('AAPL');
    });

    it('quote 가 reject 된 ticker 는 null quote 로 신호를 계산한다', async () => {
        mockCache.get.mockResolvedValue(null);
        const bars: Bar[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 1, open: 2, high: 2, low: 2, close: 2, volume: 1 },
        ];
        mockGetBars.mockReset();
        mockGetBars.mockResolvedValue(bars);
        // 첫 ticker(AAPL)의 getQuote 만 reject → combineResults line 83/84 의 null 경로.
        mockGetQuote.mockReset();
        mockGetQuote.mockRejectedValueOnce(new Error('quote down'));
        mockGetQuote.mockResolvedValue(null);
        computeStockSignalResultMock.mockReturnValue(null);

        await getSectorSignals(fakeProvider, '1Day', fixedNow);

        const firstCall = computeStockSignalResultMock.mock.calls[0];
        expect((firstCall[0] as { symbol: string }).symbol).toBe('AAPL');
        // quote reject → null 로 전달.
        expect(firstCall[2]).toBeNull();
    });

    it('fulfilled quote 와 non-null 신호는 결과에 포함된다', async () => {
        mockCache.get.mockResolvedValue(null);
        const bars: Bar[] = [
            { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 },
            { time: 1, open: 110, high: 110, low: 110, close: 110, volume: 1 },
        ];
        const quote: MarketQuote = {
            symbol: 'AAPL',
            price: 150,
            changesPercentage: 1.5,
            name: 'Apple',
        };
        const signalResult: StockSignalResult = {
            symbol: 'AAPL',
            koreanName: '애플',
            sectorSymbol: 'XLK',
            price: 150,
            changePercent: 1.5,
            trend: 'uptrend',
            signals: [],
        };
        // 첫 ticker(AAPL): bars + fulfilled quote 제공.
        mockGetBars.mockReset();
        mockGetBars.mockResolvedValueOnce(bars);
        mockGetBars.mockResolvedValue([]);
        mockGetQuote.mockReset();
        mockGetQuote.mockResolvedValueOnce(quote);
        mockGetQuote.mockResolvedValue(null);
        // quote 가 non-null 로 전달될 때만 non-null 결과를 반환 → line 84(quote.value) + line 90([result]) 동시 검증.
        computeStockSignalResultMock.mockImplementation((_stock, _bars, q) =>
            q !== null ? signalResult : null
        );

        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);

        // line 84: fulfilled quote.value 가 그대로 전달되었는지 확인.
        const firstCall = computeStockSignalResultMock.mock.calls[0];
        expect(firstCall[2]).toEqual(quote);
        // line 90: non-null 결과가 유지된다.
        expect(result.stocks).toEqual([signalResult]);
    });
});
