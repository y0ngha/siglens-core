import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitNewsCardAnalysis, NEWS_CARD_MODEL_ID } from '@/application/news/submitNewsCardAnalysis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import type { NewsItem } from '@/domain/types';

const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;

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

        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFireAndForget.mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    it('항상 submitted 상태와 jobId를 반환한다', async () => {
        const result = await submitNewsCardAnalysis({ item: testNewsItem });

        expect(result.status).toBe('submitted');
        if (result.status === 'submitted') {
            expect(typeof result.jobId).toBe('string');
            expect(result.jobId.length).toBeGreaterThan(0);
        }
    });

    it('jobId와 flash-lite 모델 ID로 작업 메타를 등록한다 (cacheKey 없음)', async () => {
        const result = await submitNewsCardAnalysis({ item: testNewsItem });

        expect(result.status).toBe('submitted');
        expect(mockSetJobMeta).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                symbol: 'AAPL',
                modelId: NEWS_CARD_MODEL_ID,
            })
        );
        expect(mockSetJobMeta).toHaveBeenCalledWith(
            expect.any(String),
            expect.not.objectContaining({ cacheKey: expect.anything() })
        );
    });

    it('fireAndForget를 통해 워커에 fetch 요청을 보낸다', async () => {
        await submitNewsCardAnalysis({ item: testNewsItem });

        expect(mockFireAndForget).toHaveBeenCalled();
    });

    describe('BackgroundTaskOptions를 받을 때', () => {
        it('waitUntil 옵션이 fireAndForget으로 전달된다', async () => {
            const waitUntil = vi.fn();
            await submitNewsCardAnalysis({ item: testNewsItem, waitUntil });

            expect(mockFireAndForget).toHaveBeenCalledWith(
                expect.any(Promise),
                expect.objectContaining({ waitUntil })
            );
        });
    });

    describe('thinkingBudget 옵션을 받을 때', () => {
        it('thinkingBudget: 0을 전달하면 워커 POST body에 포함된다', async () => {
            await submitNewsCardAnalysis({
                item: testNewsItem,
                thinkingBudget: 0,
            });

            expect(mockFetch).toHaveBeenCalled();
            const fetchBody = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(fetchBody).toHaveProperty('thinkingBudget', 0);
        });

        it('thinkingBudget을 전달하지 않으면 워커 POST body에 포함되지 않는다', async () => {
            await submitNewsCardAnalysis({ item: testNewsItem });

            expect(mockFetch).toHaveBeenCalled();
            const fetchBody = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(fetchBody).not.toHaveProperty('thinkingBudget');
        });

        it('양수 thinkingBudget을 전달하면 워커 POST body에 포함된다', async () => {
            await submitNewsCardAnalysis({
                item: testNewsItem,
                thinkingBudget: 8192,
            });

            const fetchBody = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(fetchBody).toHaveProperty('thinkingBudget', 8192);
        });
    });
});
