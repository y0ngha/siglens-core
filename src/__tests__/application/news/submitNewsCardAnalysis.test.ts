import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitNewsCardAnalysis } from '@/application/news/submitNewsCardAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import type { NewsItem, NewsCardAnalysis } from '@/domain/types';

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

/** Minimal valid NewsItem for use in tests. */
const testNewsItem: NewsItem = {
    id: 'news-test-001',
    symbol: 'AAPL',
    source: 'Reuters',
    url: 'https://reuters.com/news-test-001',
    publishedAt: '2026-05-01T10:00:00Z',
    titleEn: 'Apple announces new product lineup',
    bodyEn: 'Apple has announced a new product lineup today.',
};

/** Minimal valid NewsCardAnalysis for cache hit tests. */
const cachedCardAnalysis: NewsCardAnalysis = {
    titleKo: '애플 신제품 라인업 발표',
    bodyKo: '애플이 오늘 신제품 라인업을 발표했습니다.',
    summaryKo: '애플 신제품 라인업 발표',
    sentiment: 'bullish',
    category: 'product',
};

describe('submitNewsCardAnalysis 함수는', () => {
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

    describe('캐시 히트일 때', () => {
        it('cached 상태와 결과를 반환하고 워커를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(cachedCardAnalysis);

            const result = await submitNewsCardAnalysis({ item: testNewsItem });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toBe(cachedCardAnalysis);
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 키는 news.id로만 결정된다', async () => {
            mockCacheGet.mockResolvedValueOnce(cachedCardAnalysis);

            await submitNewsCardAnalysis({ item: testNewsItem });

            // Cache lookup was called with the key derived from item.id
            expect(mockCacheGet).toHaveBeenCalledWith(
                expect.stringContaining(testNewsItem.id)
            );
        });
    });

    describe('캐시 미스일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('submitted 상태와 jobId를 반환한다', async () => {
            const result = await submitNewsCardAnalysis({ item: testNewsItem });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
        });

        it('jobId와 flash-lite 모델 ID로 작업 메타를 등록한다', async () => {
            const result = await submitNewsCardAnalysis({ item: testNewsItem });

            expect(result.status).toBe('submitted');
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    symbol: 'AAPL',
                    modelId: 'gemini-2.5-flash-lite',
                    cacheKey: expect.any(String),
                })
            );
        });

        it('fireAndForget를 통해 워커에 fetch 요청을 보낸다', async () => {
            await submitNewsCardAnalysis({ item: testNewsItem });

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('캐시 키에 news.id가 포함된다', async () => {
            await submitNewsCardAnalysis({ item: testNewsItem });

            const meta = mockSetJobMeta.mock.calls[0]?.[1] as
                | { cacheKey: string }
                | undefined;
            expect(meta?.cacheKey).toContain(testNewsItem.id);
        });
    });

    describe('BackgroundTaskOptions를 받을 때', () => {
        it('waitUntil 옵션이 fireAndForget으로 전달된다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const waitUntil = vi.fn();
            await submitNewsCardAnalysis({ item: testNewsItem, waitUntil });

            // fireAndForget is called (which internally passes options to waitUntil)
            expect(mockFireAndForget).toHaveBeenCalledWith(
                expect.any(Promise),
                expect.objectContaining({ waitUntil })
            );
        });
    });
});
