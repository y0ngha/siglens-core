import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitMarketNewsDigest } from '@/application/news/submitMarketNewsDigest';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import type { EnrichedNewsItem, Skill } from '@/domain/types';
import { DEFAULT_TIER } from '@/domain/tier';

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

function makeNewsSkill(name: string, type?: Skill['type']): Skill {
    return {
        name,
        description: `${name} description`,
        type,
        category: 'news',
        indicators: [],
        confidenceWeight: 1,
        content: `${name} content`,
        gating: { tier: 'always_on' },
    };
}

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

    it('worker fetch가 throw하면 에러를 삼키고 submitted를 반환하며 setJobMeta는 호출된다', async () => {
        // cache miss → proceed to dispatch
        mockCacheGet.mockResolvedValue(null);
        // worker network failure — the .catch() inside submitMarketNewsDigest swallows this
        mockFetch.mockRejectedValue(new Error('Network error'));

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
        });

        // Error is swallowed via the .catch() on the fetch promise — caller still gets 'submitted'
        expect(r.status).toBe('submitted');
        // setJobMeta is called synchronously (await) BEFORE the fire-and-forget dispatch
        expect(mockSetJobMeta).toHaveBeenCalledTimes(1);
    });

    it('force=true여도 skipEnqueueIfMiss=true가 우선하여 miss_no_trigger를 반환한다', async () => {
        // cache hit setup — force=true alone would return 'submitted' (dispatch fires)
        mockCacheGet.mockResolvedValue(mockCachedResult);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            force: true,
            skipEnqueueIfMiss: true,
        });

        expect(r.status).toBe('miss_no_trigger');
        expect(mockSetJobMeta).not.toHaveBeenCalled();
        expect(mockFireAndForget).not.toHaveBeenCalled();
    });

    it('cache provider가 null이고 skipEnqueueIfMiss=true이면 miss_no_trigger를 반환한다', async () => {
        mockCreateCacheProvider.mockReturnValue(null);

        const r = await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            skipEnqueueIfMiss: true,
        });

        expect(r.status).toBe('miss_no_trigger');
        expect(mockCacheGet).not.toHaveBeenCalled();
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

        const body = JSON.parse(
            mockFetch.mock.calls[0][1].body as string
        ) as Record<string, unknown>;
        expect(body.tier).toBe(DEFAULT_TIER);
    });

    it('free tier는 selectSkills 전에 type 그룹과 regular 그룹을 각각 세 개로 제한한다', async () => {
        const skills = [
            ...Array.from({ length: 4 }, (_, index) =>
                makeNewsSkill(`typed-news-${index}`, 'pattern')
            ),
            ...Array.from({ length: 4 }, (_, index) =>
                makeNewsSkill(`regular-news-${index}`)
            ),
        ];
        mockCacheGet.mockResolvedValue(null);

        await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            skills,
            tier: 'free',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
            system: string;
            tier: string;
        };
        expect(body.system.match(/### typed-news-\d/g)).toHaveLength(3);
        expect(body.system.match(/### regular-news-\d/g)).toHaveLength(3);
        expect(body.tier).toBe('free');
    });

    it('free와 member는 동일한 sampled skill set에서도 별도 캐시 키를 사용한다', async () => {
        const skills = [
            makeNewsSkill('shared-news-one'),
            makeNewsSkill('shared-news-two'),
        ];
        mockCacheGet.mockResolvedValue(null);

        await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            skills,
            tier: 'free',
        });
        const freeCacheKey = mockCacheGet.mock.calls[0]?.[0] as string;

        mockCacheGet.mockClear();
        await submitMarketNewsDigest({
            category: 'crypto',
            categoryLabel: '미국 암호화폐',
            modelId: 'gemini-2.5-flash',
            news: [ITEM],
            skills,
            tier: 'member',
        });
        const memberCacheKey = mockCacheGet.mock.calls[0]?.[0] as string;

        expect(freeCacheKey).not.toBe(memberCacheKey);
    });
});
