import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitMarketNewsDigest } from '@/application/news/submitMarketNewsDigest';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import type { EnrichedNewsItem } from '@/domain/types';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

const ITEM: EnrichedNewsItem = {
    id: 'c1',
    symbol: '__NEWS_CRYPTO__',
    source: 'CoinWire',
    url: 'https://example.com/btc',
    publishedAt: '2026-06-15T12:00:00Z',
    titleEn: 'BTC ETF inflows',
    bodyEn: null,
    card: {
        titleKo: 'BTC ETF 유입',
        bodyKo: null,
        summaryKo: '유입',
        sentiment: 'bullish',
        category: 'macro',
        priceImpact: 'high',
    },
};

const mockCachedResult = {
    currentDriverKo: '캐시된 카테고리 분석입니다.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'neutral' as const,
};

describe('submitMarketNewsDigest 함수는', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };

        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFireAndForget.mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    it('뉴스가 비어있으면 no_news를 반환한다', async () => {
        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [],
        });
        expect(r.status).toBe('no_news');
        expect(mockSetJobMeta).not.toHaveBeenCalled();
        expect(mockFireAndForget).not.toHaveBeenCalled();
    });

    it('봇(skipEnqueueIfMiss)이고 캐시 미스면 miss_no_trigger를 반환한다', async () => {
        mockCacheGet.mockResolvedValue(null);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            skipEnqueueIfMiss: true,
        });

        expect(r.status).toBe('miss_no_trigger');
        expect(mockSetJobMeta).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('캐시 히트면 cached 결과를 반환한다', async () => {
        mockCacheGet.mockResolvedValue(mockCachedResult);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
        });

        expect(r.status).toBe('cached');
        if (r.status === 'cached') {
            expect(r.result).toEqual(mockCachedResult);
        }
        expect(mockSetJobMeta).not.toHaveBeenCalled();
        expect(mockFireAndForget).not.toHaveBeenCalled();
    });

    it('force=true면 캐시 히트를 무시하고 worker dispatch + submitted를 반환한다', async () => {
        // Cache has a result — without force this would return 'cached'.
        mockCacheGet.mockResolvedValue(mockCachedResult);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            force: true,
        });

        // force bypasses the cache hit → dispatch must have fired.
        expect(r.status).toBe('submitted');
        if (r.status === 'submitted') {
            expect(typeof r.jobId).toBe('string');
            expect(r.jobId.length).toBeGreaterThan(0);
        }
        expect(mockSetJobMeta).toHaveBeenCalledTimes(1);
        expect(mockFireAndForget).toHaveBeenCalledTimes(1);
    });

    it('동일한 캐시 히트 상태에서 force를 끄면 cached를 반환한다', async () => {
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(mockCachedResult);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFireAndForget.mockImplementation(() => undefined);

        const rCached = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
        });

        expect(rCached.status).toBe('cached');
        expect(mockFireAndForget).not.toHaveBeenCalled();
    });

    it('캐시 프로바이더가 null이면 cache.get을 호출하지 않고 submitted를 반환한다', async () => {
        mockCreateCacheProvider.mockReturnValue(null);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
        });

        expect(r.status).toBe('submitted');
        expect(mockCacheGet).not.toHaveBeenCalled();
        expect(mockSetJobMeta).toHaveBeenCalledTimes(1);
        expect(mockFireAndForget).toHaveBeenCalledTimes(1);
    });

    it('cache.get이 throw하면 에러를 삼키고 submitted를 반환한다', async () => {
        mockCacheGet.mockRejectedValue(new Error('Redis connection refused'));

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
        });

        expect(r.status).toBe('submitted');
        expect(mockSetJobMeta).toHaveBeenCalledTimes(1);
        expect(mockFireAndForget).toHaveBeenCalledTimes(1);
    });

    it('사람 + 캐시 미스면 worker dispatch + submitted를 반환한다', async () => {
        mockCacheGet.mockResolvedValue(null);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
        });

        expect(r.status).toBe('submitted');
        if (r.status === 'submitted') {
            expect(typeof r.jobId).toBe('string');
            expect(r.jobId.length).toBeGreaterThan(0);
        }
        expect(mockSetJobMeta).toHaveBeenCalledTimes(1);
        expect(mockFireAndForget).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/analyze'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'X-Worker-Secret': expect.any(String),
                }),
                body: expect.stringContaining('"analysisType":"news"'),
            })
        );
        // setJobMeta must carry the cacheKey so pollMarketNewsDigest can write-through.
        expect(mockSetJobMeta).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                category: 'crypto',
                modelId: 'gemini-2.5-flash',
                cacheKey: expect.any(String),
            })
        );
    });
});
