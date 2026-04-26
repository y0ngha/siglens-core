import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetInfo } from '@/domain/types';
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
const getKoreanNamesMock =
    vi.fn<(symbols: string[]) => Promise<Record<string, string>>>();
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
    };
});
vi.mock('@/infrastructure/ticker/koreanNameStore', () => ({
    getKoreanNames: (symbols: string[]) => getKoreanNamesMock(symbols),
    setKoreanTickers: () => setKoreanTickersMock(),
}));
vi.mock('@/infrastructure/ticker/koreanTranslator', () => ({
    translateCompanyNames: () => translateCompanyNamesMock(),
}));

import { getAssetInfo } from '@/application/ticker/getAssetInfo';

const apple: FmpSearchResult = {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    currency: 'USD',
    exchange: 'NASDAQ',
    exchangeFullName: 'NASDAQ Global Select',
};

describe('getAssetInfo', () => {
    beforeEach(() => {
        mockCache.get.mockReset();
        mockCache.set.mockReset();
        mockCache.set.mockResolvedValue(undefined);
        createCacheProviderMock.mockReset();
        createCacheProviderMock.mockReturnValue(mockCache);
        searchBySymbolMock.mockReset();
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

    it('잘못된 ticker format 은 null 반환', async () => {
        await expect(getAssetInfo('toolong')).resolves.toBeNull();
        expect(searchBySymbolMock).not.toHaveBeenCalled();
    });

    it('cache hit 시 cached 결과 반환', async () => {
        const cached: AssetInfo = { symbol: 'AAPL', name: 'Apple' };
        mockCache.get.mockResolvedValue(cached);
        await expect(getAssetInfo('aapl')).resolves.toBe(cached);
        expect(searchBySymbolMock).not.toHaveBeenCalled();
    });

    it('cache miss 시 FMP 호출 → 한국명 미보유면 결과 반환 후 번역 fire-and-forget', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        getKoreanNamesMock.mockResolvedValue({});
        translateCompanyNamesMock.mockResolvedValue({ AAPL: '애플' });

        const result = await getAssetInfo('AAPL');
        expect(result).toEqual({ symbol: 'AAPL', name: 'Apple Inc.' });
        expect(mockCache.set).toHaveBeenCalledWith(
            'asset-info:AAPL',
            { symbol: 'AAPL', name: 'Apple Inc.' },
            expect.any(Number)
        );
    });

    it('한국명 보유 시 koreanName을 결과에 포함하고 긴 TTL 사용', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        getKoreanNamesMock.mockResolvedValue({ AAPL: '애플' });

        const result = await getAssetInfo('AAPL');
        expect(result).toEqual({
            symbol: 'AAPL',
            name: 'Apple Inc.',
            koreanName: '애플',
        });
        const ttlUsed = mockCache.set.mock.calls[0][2] as number;
        expect(ttlUsed).toBeGreaterThan(60 * 60 * 24); // longer than a day
    });

    it('FMP 매치가 없으면 null 반환', async () => {
        mockCache.get.mockResolvedValue(null);
        searchBySymbolMock.mockResolvedValue([]);
        await expect(getAssetInfo('AAPL')).resolves.toBeNull();
    });

    it('cache provider 가 null 이어도 동작한다', async () => {
        createCacheProviderMock.mockReturnValue(null);
        searchBySymbolMock.mockResolvedValue([apple]);
        await expect(getAssetInfo('AAPL')).resolves.toEqual({
            symbol: 'AAPL',
            name: 'Apple Inc.',
        });
    });

    it('cache get 실패 시 fallback 으로 FMP 호출', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        searchBySymbolMock.mockResolvedValue([apple]);
        getKoreanNamesMock.mockResolvedValue({});
        const result = await getAssetInfo('AAPL');
        expect(result).toEqual({ symbol: 'AAPL', name: 'Apple Inc.' });
    });
});
