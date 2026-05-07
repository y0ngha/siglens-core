import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollNewsCardAnalysis } from '@/application/news/pollNewsCardAnalysis';
import { NEWS_CARD_MODEL_ID } from '@/application/news/submitNewsCardAnalysis';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    getJobMeta,
} from '@/infrastructure/jobs/queue';
import { cleanupInBackground } from '@/application/background';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockCleanupInBackground = cleanupInBackground as Mock;

/** Minimal valid raw news card analysis result. */
const rawCardJson = JSON.stringify({
    titleKo: '애플, 신제품 발표',
    bodyKo: '애플이 오늘 신제품을 발표했습니다.',
    summaryKo: '애플 신제품 발표 요약',
    sentiment: 'bullish',
    category: 'product',
    priceImpact: 'medium',
});

const mockMeta = {
    symbol: 'AAPL',
    modelId: NEWS_CARD_MODEL_ID,
};

describe('pollNewsCardAnalysis 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCleanupInBackground.mockImplementation(() => undefined);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);
            const result = await pollNewsCardAnalysis('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollNewsCardAnalysis('job-2');
            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('getJobError를 호출하고 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Card analysis failed');

            const result = await pollNewsCardAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Card analysis failed');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollNewsCard]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollNewsCardAnalysis('job-err-null');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Unknown error');
            }
        });
    });

    describe('status가 done일 때', () => {
        beforeEach(() => {
            mockGetJobStatus.mockResolvedValue('done');
            mockGetJobMeta.mockResolvedValue(mockMeta);
        });

        it('결과가 없으면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(null);

            const result = await pollNewsCardAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
        });

        it('normalize가 실패하면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce('invalid json {{{');

            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = await pollNewsCardAnalysis('job-invalid');
            consoleSpy.mockRestore();

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawCardJson);

            const result = await pollNewsCardAnalysis('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.titleKo).toBe('애플, 신제품 발표');
                expect(result.result.sentiment).toBe('bullish');
                expect(result.result.priceImpact).toBe('medium');
            }
        });

        it('완료 후 Redis 캐시에 저장하지 않는다 (DB persistence는 호출 측 책임)', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawCardJson);

            const result = await pollNewsCardAnalysis('job-done-no-cache');

            expect(result.status).toBe('done');
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-done-no-cache',
                '[PollNewsCard]',
                undefined
            );
        });

        it('빈 응답이 감지되면 경고를 로그하고 done을 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(JSON.stringify({}));
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const result = await pollNewsCardAnalysis('job-empty');

            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[PollNewsCard] Empty news card analysis',
                { jobId: 'job-empty' }
            );
            warnSpy.mockRestore();
        });
    });
});
