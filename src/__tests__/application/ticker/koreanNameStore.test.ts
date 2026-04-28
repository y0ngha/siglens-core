import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheProvider } from '@/infrastructure/cache/types';
import type {
    DatabaseClient,
    KoreanTickerRepository,
} from '@/infrastructure/db/types';

const mockCache: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
} = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
};

const mockRepository: {
    findAll: ReturnType<typeof vi.fn>;
    findBySymbols: ReturnType<typeof vi.fn>;
    upsertMany: ReturnType<typeof vi.fn>;
} = {
    findAll: vi.fn(),
    findBySymbols: vi.fn(),
    upsertMany: vi.fn(),
};

const createCacheProviderMock = vi.fn<() => CacheProvider | null>();
const tryGetDatabaseClientMock = vi.fn<() => DatabaseClient | null>();
const repositoryFactoryMock = vi.fn<(db: unknown) => KoreanTickerRepository>();

vi.mock('@/infrastructure/cache/redis', () => ({
    createCacheProvider: () => createCacheProviderMock(),
}));
vi.mock('@/infrastructure/db/client', () => ({
    tryGetDatabaseClient: () => tryGetDatabaseClientMock(),
}));
vi.mock('@/infrastructure/db/tickerRepository', () => ({
    DrizzleKoreanTickerRepository: class {
        constructor(db: unknown) {
            return repositoryFactoryMock(db);
        }
    },
}));

import {
    getKoreanNames,
    searchByKoreanName,
    setKoreanTickers,
} from '@/application/ticker/koreanNameStore';
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

const fakeDbClient = {
    db: {} as unknown,
    sql: {} as unknown,
} as DatabaseClient;

function resetMocks(): void {
    mockCache.get.mockReset();
    mockCache.set.mockReset();
    mockCache.set.mockResolvedValue(undefined);
    mockCache.delete.mockReset();
    mockRepository.findAll.mockReset();
    mockRepository.findBySymbols.mockReset();
    mockRepository.findBySymbols.mockResolvedValue([]);
    mockRepository.upsertMany.mockReset();
    mockRepository.upsertMany.mockResolvedValue(undefined);
    createCacheProviderMock.mockReset();
    createCacheProviderMock.mockReturnValue(mockCache);
    tryGetDatabaseClientMock.mockReset();
    tryGetDatabaseClientMock.mockReturnValue(fakeDbClient);
    repositoryFactoryMock.mockReset();
    repositoryFactoryMock.mockReturnValue(mockRepository);
}

describe('searchByKoreanName', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.clearAllMocks());

    it('cache hit 시 cache 결과로 검색한다', async () => {
        mockCache.get.mockResolvedValue([apple, microsoft]);
        const result = await searchByKoreanName('애');
        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('AAPL');
        expect(mockRepository.findAll).not.toHaveBeenCalled();
    });

    it('cache miss(null) 시 DB 조회 후 cache 갱신', async () => {
        mockCache.get.mockResolvedValue(null);
        mockRepository.findAll.mockResolvedValue([apple]);
        const result = await searchByKoreanName('애');
        expect(result[0].symbol).toBe('AAPL');
        expect(createCacheProviderMock).toHaveBeenCalledTimes(1);
        expect(mockCache.set).toHaveBeenCalledWith(
            'korean:tickers',
            [apple],
            expect.any(Number)
        );
    });

    it('cache get 실패 시 DB 로 폴백한다', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        mockRepository.findAll.mockResolvedValue([apple]);
        const result = await searchByKoreanName('애');
        expect(result[0].symbol).toBe('AAPL');
    });

    it('cache 와 DB 모두 비어있으면 빈 배열', async () => {
        mockCache.get.mockResolvedValue(null);
        mockRepository.findAll.mockResolvedValue([]);
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('cache miss 후 DB 조회 실패 시 빈 배열로 degrade 한다', async () => {
        mockCache.get.mockResolvedValue(null);
        mockRepository.findAll.mockRejectedValue(new Error('db down'));
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('DB 클라이언트 없고 cache 도 없으면 빈 배열', async () => {
        createCacheProviderMock.mockReturnValue(null);
        tryGetDatabaseClientMock.mockReturnValue(null);
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
    });

    it('DB 클라이언트 없고 cache 미스면 빈 배열', async () => {
        mockCache.get.mockResolvedValue(null);
        tryGetDatabaseClientMock.mockReturnValue(null);
        await expect(searchByKoreanName('애')).resolves.toEqual([]);
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('cache write 실패는 DB 결과 반환을 막지 않는다', async () => {
        mockCache.get.mockResolvedValue(null);
        mockRepository.findAll.mockResolvedValue([apple]);
        mockCache.set.mockRejectedValue(new Error('cache write down'));
        const result = await searchByKoreanName('애');
        expect(result[0].symbol).toBe('AAPL');
    });
});

describe('getKoreanNames', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.clearAllMocks());

    it('빈 symbols 입력은 cache 호출 없이 빈 객체 반환', async () => {
        await expect(getKoreanNames([])).resolves.toEqual({});
        expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('cache 결과에서 매핑된 symbol 만 반환', async () => {
        mockCache.get.mockResolvedValue([apple, microsoft]);
        const result = await getKoreanNames(['AAPL', 'TSLA']);
        expect(result).toEqual({ AAPL: '애플' });
    });

    it('cache miss 시 DB 결과를 매핑한다', async () => {
        mockCache.get.mockResolvedValue(null);
        mockRepository.findBySymbols.mockResolvedValue([microsoft]);
        const result = await getKoreanNames(['MSFT']);
        expect(result).toEqual({ MSFT: '마이크로소프트' });
        expect(mockRepository.findBySymbols).toHaveBeenCalledWith(['MSFT']);
        expect(mockRepository.findAll).not.toHaveBeenCalled();
    });

    it('cache miss 후 DB symbol 조회 실패 시 빈 객체로 degrade 한다', async () => {
        mockCache.get.mockResolvedValue(null);
        mockRepository.findBySymbols.mockRejectedValue(new Error('db down'));
        await expect(getKoreanNames(['MSFT'])).resolves.toEqual({});
    });

    it('cache miss + DB 클라이언트 없으면 빈 객체 반환', async () => {
        mockCache.get.mockResolvedValue(null);
        tryGetDatabaseClientMock.mockReturnValue(null);
        await expect(getKoreanNames(['AAPL'])).resolves.toEqual({});
        expect(mockRepository.findBySymbols).not.toHaveBeenCalled();
    });
});

describe('setKoreanTickers', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.clearAllMocks());

    it('빈 배열은 DB / cache 호출 없이 종료한다', async () => {
        await setKoreanTickers([]);
        expect(mockRepository.upsertMany).not.toHaveBeenCalled();
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('DB upsert 후 전체 cache 를 무효화한다', async () => {
        await setKoreanTickers([apple]);
        expect(mockRepository.upsertMany).toHaveBeenCalledWith([apple]);
        expect(mockCache.delete).toHaveBeenCalledWith('korean:tickers');
        expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('DB upsert 후 cache 삭제 실패는 흡수한다', async () => {
        mockCache.delete.mockRejectedValue(new Error('cache down'));
        await expect(setKoreanTickers([apple])).resolves.toBeUndefined();
        expect(mockRepository.upsertMany).toHaveBeenCalledWith([apple]);
    });

    it('DB 클라이언트 없으면 DB / cache 호출 없이 종료', async () => {
        tryGetDatabaseClientMock.mockReturnValue(null);
        await setKoreanTickers([apple]);
        expect(mockRepository.upsertMany).not.toHaveBeenCalled();
        expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('DB upsert 실패 시 cache 도 건드리지 않고 종료', async () => {
        mockRepository.upsertMany.mockRejectedValue(new Error('db down'));
        await setKoreanTickers([apple]);
        expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('cache provider 가 null 이면 DB 만 갱신', async () => {
        createCacheProviderMock.mockReturnValue(null);
        await setKoreanTickers([apple]);
        expect(mockRepository.upsertMany).toHaveBeenCalledTimes(1);
        expect(mockCache.delete).not.toHaveBeenCalled();
    });
});
