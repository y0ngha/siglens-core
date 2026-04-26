import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheProvider } from '@/infrastructure/cache/types';

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

vi.mock('@/infrastructure/cache/redis', () => ({
    createCacheProvider: () => createCacheProviderMock(),
}));

import {
    getKoreanNames,
    searchByKoreanName,
    setKoreanTickers,
} from '@/infrastructure/ticker/koreanNameStore';
import type { KoreanTickerEntry } from '@/domain/types';

const apple: KoreanTickerEntry = {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    koreanName: '애플',
    exchange: 'NASDAQ',
    exchangeFullName: 'NASDAQ Global Select',
};

const microsoft: KoreanTickerEntry = {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    koreanName: '마이크로소프트',
    exchange: 'NASDAQ',
    exchangeFullName: 'NASDAQ Global Select',
};

beforeEach(() => {
    mockCache.get.mockReset();
    mockCache.set.mockReset();
    mockCache.delete.mockReset();
    createCacheProviderMock.mockReturnValue(mockCache);
});

afterEach(() => {
    createCacheProviderMock.mockReset();
});

describe('searchByKoreanName', () => {
    it('cache provider 가 null 이면 빈 배열 반환', async () => {
        createCacheProviderMock.mockReturnValue(null);
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
    });

    it('koreanName 부분 일치를 case-insensitive 로 찾는다', async () => {
        mockCache.get.mockResolvedValue([apple, microsoft]);
        const result = await searchByKoreanName('애');
        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('AAPL');
    });

    it('cache get 실패 시 빈 배열로 안전하게 처리한다', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
    });

    it('null entries 응답을 빈 배열로 처리한다', async () => {
        mockCache.get.mockResolvedValue(null);
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
    });
});

describe('getKoreanNames', () => {
    it('빈 symbols 입력은 즉시 빈 객체 반환', async () => {
        await expect(getKoreanNames([])).resolves.toEqual({});
        expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('cache provider 가 null 이면 빈 객체 반환', async () => {
        createCacheProviderMock.mockReturnValue(null);
        await expect(getKoreanNames(['AAPL'])).resolves.toEqual({});
    });

    it('매핑된 symbol 만 반환한다', async () => {
        mockCache.get.mockResolvedValue([apple, microsoft]);
        const result = await getKoreanNames(['AAPL', 'TSLA']);
        expect(result).toEqual({ AAPL: '애플' });
    });
});

describe('setKoreanTickers', () => {
    it('빈 배열은 cache 호출 없이 종료한다', async () => {
        await setKoreanTickers([]);
        expect(mockCache.get).not.toHaveBeenCalled();
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('cache provider 가 null 이면 아무 동작도 하지 않는다', async () => {
        createCacheProviderMock.mockReturnValue(null);
        await setKoreanTickers([apple]);
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('기존 entry 와 신규 entry 를 symbol 기준으로 머지한다', async () => {
        const oldApple: KoreanTickerEntry = { ...apple, koreanName: '구버전' };
        mockCache.get.mockResolvedValue([oldApple, microsoft]);
        await setKoreanTickers([apple]);
        expect(mockCache.set).toHaveBeenCalledTimes(1);
        const [, mergedValue] = mockCache.set.mock.calls[0];
        expect(mergedValue).toEqual([microsoft, apple]);
    });

    it('기존 cache 가 비어있을 때도 신규 entry 를 저장한다', async () => {
        mockCache.get.mockResolvedValue(null);
        await setKoreanTickers([apple]);
        expect(mockCache.set).toHaveBeenCalledWith(
            'korean:tickers',
            [apple],
            expect.any(Number)
        );
    });

    it('cache 실패는 흡수한다', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        await expect(setKoreanTickers([apple])).resolves.toBeUndefined();
    });
});
