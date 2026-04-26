import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TickerSearchResult } from '@/domain/types';
import type { CacheProvider } from '@/infrastructure/cache/types';
import type { FmpSearchResult } from '@/infrastructure/ticker/types';

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
const searchBySymbolMock = vi.fn<(q: string) => Promise<FmpSearchResult[]>>();
const searchByNameMock = vi.fn<(q: string) => Promise<FmpSearchResult[]>>();
const searchByKoreanNameMock =
    vi.fn<(q: string) => Promise<TickerSearchResult[]>>();
const getKoreanNamesMock =
    vi.fn<(s: string[]) => Promise<Record<string, string>>>();
const setKoreanTickersMock = vi.fn<() => Promise<void>>();
const translateCompanyNamesMock =
    vi.fn<() => Promise<Record<string, string>>>();

vi.mock('@/infrastructure/cache/redis', () => ({
    createCacheProvider: () => createCacheProviderMock(),
}));
vi.mock('@/infrastructure/ticker/fmpTickerApi', async () => {
    const actual = await vi.importActual<
        typeof import('@/infrastructure/ticker/fmpTickerApi')
    >('@/infrastructure/ticker/fmpTickerApi');
    return {
        ...actual,
        searchBySymbol: (q: string) => searchBySymbolMock(q),
        searchByName: (q: string) => searchByNameMock(q),
    };
});
vi.mock('@/infrastructure/ticker/koreanNameStore', () => ({
    searchByKoreanName: (q: string) => searchByKoreanNameMock(q),
    getKoreanNames: (s: string[]) => getKoreanNamesMock(s),
    setKoreanTickers: () => setKoreanTickersMock(),
}));
vi.mock('@/infrastructure/ticker/koreanTranslator', () => ({
    translateCompanyNames: () => translateCompanyNamesMock(),
}));

import { searchTicker } from '@/application/ticker/searchTicker';

const apple: FmpSearchResult = {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    currency: 'USD',
    exchange: 'NASDAQ',
    exchangeFullName: 'NASDAQ Global Select',
};

const microsoft: FmpSearchResult = {
    symbol: 'MSFT',
    name: 'Microsoft',
    currency: 'USD',
    exchange: 'NASDAQ',
    exchangeFullName: 'NASDAQ Global Select',
};

describe('searchTicker', () => {
    beforeEach(() => {
        mockCache.get.mockReset();
        mockCache.set.mockReset();
        mockCache.set.mockResolvedValue(undefined);
        createCacheProviderMock.mockReset();
        createCacheProviderMock.mockReturnValue(mockCache);
        searchBySymbolMock.mockReset();
        searchByNameMock.mockReset();
        searchByKoreanNameMock.mockReset();
        getKoreanNamesMock.mockReset();
        getKoreanNamesMock.mockResolvedValue({});
        setKoreanTickersMock.mockReset();
        setKoreanTickersMock.mockResolvedValue();
        translateCompanyNamesMock.mockReset();
        translateCompanyNamesMock.mockResolvedValue({});
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('빈 query 는 빈 배열 반환', async () => {
        await expect(searchTicker('   ')).resolves.toEqual([]);
        expect(searchBySymbolMock).not.toHaveBeenCalled();
    });

    it('한글 query 는 koreanNameStore 검색 결과를 반환한다', async () => {
        const koreanResults: TickerSearchResult[] = [
            {
                symbol: 'AAPL',
                name: 'Apple Inc.',
                koreanName: '애플',
                exchange: 'NASDAQ',
                exchangeFullName: 'NASDAQ Global Select',
            },
        ];
        searchByKoreanNameMock.mockResolvedValue(koreanResults);
        await expect(searchTicker('애')).resolves.toEqual(koreanResults);
        expect(searchBySymbolMock).not.toHaveBeenCalled();
    });

    it('cache hit 시 cached 값을 반환한다', async () => {
        const cached: TickerSearchResult[] = [
            {
                symbol: 'AAPL',
                name: 'Apple Inc.',
                exchange: 'NASDAQ',
                exchangeFullName: 'NASDAQ Global Select',
            },
        ];
        mockCache.get.mockResolvedValue(cached);
        await expect(searchTicker('AAPL')).resolves.toEqual(cached);
        expect(searchBySymbolMock).not.toHaveBeenCalled();
    });

    it('cache miss 시 FMP 결과를 한국명과 함께 반환한다', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        searchByNameMock.mockResolvedValue([microsoft]);
        getKoreanNamesMock.mockResolvedValue({ AAPL: '애플' });

        const result = await searchTicker('AAPL');
        expect(result).toEqual([
            {
                symbol: 'AAPL',
                name: 'Apple Inc.',
                exchange: 'NASDAQ',
                exchangeFullName: 'NASDAQ Global Select',
                koreanName: '애플',
            },
            {
                symbol: 'MSFT',
                name: 'Microsoft',
                exchange: 'NASDAQ',
                exchangeFullName: 'NASDAQ Global Select',
                koreanName: undefined,
            },
        ]);
        expect(mockCache.set).toHaveBeenCalledWith(
            'ticker:search:aapl',
            result,
            expect.any(Number)
        );
    });

    it('중복 심볼은 제거한다', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        searchByNameMock.mockResolvedValue([apple]);
        getKoreanNamesMock.mockResolvedValue({});

        const result = await searchTicker('AAPL');
        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('AAPL');
    });

    it('한국명 미보유 항목이 있으면 번역을 fire-and-forget 으로 트리거한다', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        searchByNameMock.mockResolvedValue([]);
        getKoreanNamesMock.mockResolvedValue({});
        translateCompanyNamesMock.mockResolvedValue({ AAPL: '애플' });

        await searchTicker('AAPL');
        expect(translateCompanyNamesMock).toHaveBeenCalledTimes(1);
    });

    it('cache provider 가 null 이어도 정상 동작', async () => {
        createCacheProviderMock.mockReturnValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        searchByNameMock.mockResolvedValue([]);
        getKoreanNamesMock.mockResolvedValue({});
        const result = await searchTicker('AAPL');
        expect(result).toHaveLength(1);
    });

    it('cache get 실패 시 fallback 동작', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        searchBySymbolMock.mockResolvedValue([apple]);
        searchByNameMock.mockResolvedValue([]);
        getKoreanNamesMock.mockResolvedValue({});
        const result = await searchTicker('AAPL');
        expect(result).toHaveLength(1);
    });

    it('US 거래소가 아닌 결과는 제외한다', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([{ ...apple, exchange: 'TOKYO' }]);
        searchByNameMock.mockResolvedValue([]);
        getKoreanNamesMock.mockResolvedValue({});

        const result = await searchTicker('AAPL');
        expect(result).toEqual([]);
    });
});
