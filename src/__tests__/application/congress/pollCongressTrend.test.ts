import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollCongressTrend } from '@/application/congress/pollCongressTrend';
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

/** Minimal valid raw congress trend result string. */
const rawCongressJson = JSON.stringify({
    summaryKo: '상·하원 순매수 우세',
    notableMembersKo: ['Jane Doe 상원의원'],
    riskNoteKo: '공시 지연 최대 45일 주의',
    overallSentiment: 'bullish',
});

const mockMeta = {
    symbol: 'AAPL',
    modelId: 'gemini-2.5-flash',
    cacheKey: 'v1:analysis:congress:AAPL:gemini-2.5-flash:p1:abc123',
};

describe('pollCongressTrend 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockFireAndForget.mockImplementation(() => undefined);
        mockCleanupInBackground.mockImplementation(() => undefined);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);
            const result = await pollCongressTrend('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollCongressTrend('job-2');
            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('에러 메시지와 함께 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Worker crashed');

            const result = await pollCongressTrend('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Worker crashed');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollCongress]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollCongressTrend('job-err-null');

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

            const result = await pollCongressTrend('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawCongressJson);

            const result = await pollCongressTrend('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.summaryKo).toBe('상·하원 순매수 우세');
                expect(result.result.overallSentiment).toBe('bullish');
                expect(result.result.notableMembersKo).toEqual([
                    'Jane Doe 상원의원',
                ]);
            }
        });

        it('malformed JSON이면 error를 반환한다 (typed-safe)', async () => {
            mockGetJobResult.mockResolvedValueOnce('not valid json {{{');

            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = await pollCongressTrend('job-invalid');
            consoleSpy.mockRestore();

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('meta.cacheKey가 있으면 캐시에 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawCongressJson);

            await pollCongressTrend('job-cache');

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('meta.cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'flash',
            });
            mockGetJobResult.mockResolvedValueOnce(rawCongressJson);

            await pollCongressTrend('job-no-cache-key');

            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 저장을 건너뛴다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            mockGetJobResult.mockResolvedValueOnce(rawCongressJson);

            const result = await pollCongressTrend('job-no-provider');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('빈 응답이면 경고를 로그하고 done을 반환한다 (typed-safe)', async () => {
            mockGetJobResult.mockResolvedValueOnce(JSON.stringify({}));
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const result = await pollCongressTrend('job-empty');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                // Normalizer never throws — empty payload becomes a safe typed shape.
                expect(result.result.summaryKo).toBe('');
                expect(result.result.notableMembersKo).toEqual([]);
                expect(result.result.overallSentiment).toBe('neutral');
            }
            expect(warnSpy).toHaveBeenCalledWith(
                '[PollCongress] Empty congress trend analysis',
                { jobId: 'job-empty' }
            );
            warnSpy.mockRestore();
        });
    });
});
