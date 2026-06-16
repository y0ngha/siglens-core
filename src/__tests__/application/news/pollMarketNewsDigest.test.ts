import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollMarketNewsDigest } from '@/application/news/pollMarketNewsDigest';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    getJobMeta,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { fireAndForget, cleanupInBackground } from '@/application/background';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockCleanupInBackground = cleanupInBackground as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };

const rawNewsJson = JSON.stringify({
    currentDriverKo: '암호화폐 카테고리 핵심 흐름',
    keyEventsKo: ['BTC ETF 유입 사상 최대'],
    upcomingEventsKo: [],
    overallSentiment: 'bullish',
});

const mockMeta = {
    symbol: 'crypto', // category repurposed as symbol
    modelId: 'gemini-2.5-flash',
    cacheKey: 'v1:analysis:market-news:crypto:gemini-2.5-flash:abc123',
};

describe('pollMarketNewsDigest 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockFireAndForget.mockImplementation(() => undefined);
        mockCleanupInBackground.mockImplementation(() => undefined);
    });

    it('status가 null이면 processing을 반환한다', async () => {
        mockGetJobStatus.mockResolvedValueOnce(null);
        const result = await pollMarketNewsDigest('job-1');
        expect(result.status).toBe('processing');
    });

    it('status가 processing이면 processing을 반환한다', async () => {
        mockGetJobStatus.mockResolvedValueOnce('processing');
        const result = await pollMarketNewsDigest('job-2');
        expect(result.status).toBe('processing');
    });

    it('status가 error이면 error 상태를 반환한다', async () => {
        mockGetJobStatus.mockResolvedValueOnce('error');
        mockGetJobError.mockResolvedValueOnce('LLM timeout');

        const result = await pollMarketNewsDigest('job-err');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error).toBe('LLM timeout');
        }
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'job-err',
            '[PollMarketNewsDigest]',
            undefined
        );
    });

    it('결과가 없으면 error를 반환한다', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(null);
        mockGetJobMeta.mockResolvedValueOnce(mockMeta);

        const result = await pollMarketNewsDigest('job-no-result');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error).toBe('Result not found');
        }
    });

    it('done이면 정규화된 결과를 반환하고 캐시에 쓴다', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(rawNewsJson);
        mockGetJobMeta.mockResolvedValueOnce(mockMeta);

        const result = await pollMarketNewsDigest('job-done');

        expect(result.status).toBe('done');
        if (result.status === 'done') {
            expect(result.result.currentDriverKo).toBe(
                '암호화폐 카테고리 핵심 흐름'
            );
            expect(result.result.overallSentiment).toBe('bullish');
        }
        expect(mockFireAndForget).toHaveBeenCalled();
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'job-done',
            '[PollMarketNewsDigest]',
            undefined
        );
    });

    it('정규화 실패 시 error를 반환한다', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        // Pass invalid JSON that will fail normalizeNewsAnalysisResponse
        mockGetJobResult.mockResolvedValueOnce('invalid json {{{{');
        mockGetJobMeta.mockResolvedValueOnce(mockMeta);

        const result = await pollMarketNewsDigest('job-normalize-fail');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error).toBe('Invalid response from worker');
        }
        expect(mockCleanupInBackground).toHaveBeenCalled();
    });

    it('빈 결과도 done을 반환한다(warn 경로)', async () => {
        const emptyJson = JSON.stringify({
            currentDriverKo: '',
            keyEventsKo: [],
            upcomingEventsKo: [],
            overallSentiment: 'neutral',
        });
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(emptyJson);
        mockGetJobMeta.mockResolvedValueOnce(mockMeta);

        const result = await pollMarketNewsDigest('job-empty');

        expect(result.status).toBe('done');
        if (result.status === 'done') {
            expect(result.result.keyEventsKo).toHaveLength(0);
        }
    });

    it('cacheKey가 없으면 캐시에 쓰지 않는다', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(rawNewsJson);
        // meta without cacheKey
        mockGetJobMeta.mockResolvedValueOnce({
            symbol: 'crypto',
            modelId: 'gemini-2.5-flash',
        });

        const result = await pollMarketNewsDigest('job-no-key');

        expect(result.status).toBe('done');
        expect(mockFireAndForget).not.toHaveBeenCalled();
    });
});
