import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollOverallAnalysis } from '@/application/overall/pollOverallAnalysis';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    getJobMeta,
    cleanupJob,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { buildOverallPeekCacheKey } from '@/infrastructure/cache/config';
import { fireAndForget, cleanupInBackground } from '@/application/background';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockCleanupJob = cleanupJob as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockCleanupInBackground = cleanupInBackground as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };

/** Minimal valid raw overall analysis result. */
const rawOverallJson = JSON.stringify({
    headlineKo: '3축 종합 분석 결과',
    technicalBulletsKo: ['상승 추세 유지'],
    fundamentalBulletsKo: ['밸류에이션 적정'],
    newsBulletsKo: ['긍정적 뉴스 흐름'],
    optionsBulletsKo: [],
    integratedConclusionKo: '세 축 모두 긍정적',
    scenarios: [
        {
            name: 'bullish',
            triggerConditionKo: '210 돌파',
            priceRangeKo: '210-230',
        },
    ],
    riskFactorsKo: ['금리 인상 리스크'],
});

const mockMeta = {
    symbol: 'AAPL',
    timeframe: '1Day' as const,
    modelId: 'gemini-2.5-flash',
    cacheKey: 'overall:AAPL:1Day:flash:abc123',
};

describe('pollOverallAnalysis 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockCleanupJob.mockResolvedValue(undefined);
        mockFireAndForget.mockImplementation(() => undefined);
        mockCleanupInBackground.mockImplementation(() => undefined);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);
            const result = await pollOverallAnalysis('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollOverallAnalysis('job-2');
            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('getJobError를 호출하고 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Overall worker failed');

            const result = await pollOverallAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Overall worker failed');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollOverall]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollOverallAnalysis('job-err-null');

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

            const result = await pollOverallAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
        });

        it('normalize가 실패하면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce('broken json {{{');

            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = await pollOverallAnalysis('job-invalid');
            consoleSpy.mockRestore();

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            const result = await pollOverallAnalysis('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.headlineKo).toBe('3축 종합 분석 결과');
                expect(result.result.scenarios).toHaveLength(1);
            }
        });

        it('meta.cacheKey가 있으면 fireAndForget으로 캐시에 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-cache');

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('canonical 키와 content-free peek 키 양쪽에 결과를 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-dual-write');

            // canonical hashed key from meta.cacheKey
            expect(mockCacheSet).toHaveBeenCalledWith(
                mockMeta.cacheKey,
                expect.objectContaining({ headlineKo: '3축 종합 분석 결과' }),
                expect.any(Number)
            );
            // content-free peek key derived from symbol/timeframe/modelId
            expect(mockCacheSet).toHaveBeenCalledWith(
                buildOverallPeekCacheKey('AAPL', '1Day', 'gemini-2.5-flash'),
                expect.objectContaining({ headlineKo: '3축 종합 분석 결과' }),
                expect.any(Number)
            );
        });

        it('meta.reasoning=true이면 reason=on peek 키에 저장한다 (member-reasoning-toggle spec)', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                ...mockMeta,
                reasoning: true,
            });
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-reasoning-on');

            expect(mockCacheSet).toHaveBeenCalledWith(
                buildOverallPeekCacheKey(
                    'AAPL',
                    '1Day',
                    'gemini-2.5-flash',
                    true
                ),
                expect.objectContaining({ headlineKo: '3축 종합 분석 결과' }),
                expect.any(Number)
            );
            // Must NOT also write under the reasoning-off peek key.
            expect(mockCacheSet).not.toHaveBeenCalledWith(
                buildOverallPeekCacheKey('AAPL', '1Day', 'gemini-2.5-flash'),
                expect.anything(),
                expect.any(Number)
            );
        });

        it('timeframe이 없으면 peek 키 저장을 건너뛴다 (canonical만 저장)', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                cacheKey: 'overall:AAPL:1Day:flash:abc123',
            });
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-no-tf');

            expect(mockCacheSet).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                'overall:AAPL:1Day:flash:abc123',
                expect.anything(),
                expect.any(Number)
            );
        });

        it('symbol이 없으면 peek 키 저장을 건너뛴다 (canonical만 저장)', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                timeframe: '1Day' as const,
                modelId: 'gemini-2.5-flash',
                cacheKey: 'overall:AAPL:1Day:flash:abc123',
            });
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-no-symbol');

            expect(mockCacheSet).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                'overall:AAPL:1Day:flash:abc123',
                expect.anything(),
                expect.any(Number)
            );
        });

        it('modelId가 없으면 peek 키 저장을 건너뛴다 (canonical만 저장)', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                timeframe: '1Day' as const,
                cacheKey: 'overall:AAPL:1Day:flash:abc123',
            });
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-no-model');

            expect(mockCacheSet).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                'overall:AAPL:1Day:flash:abc123',
                expect.anything(),
                expect.any(Number)
            );
        });

        it('meta.cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'flash',
            });
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            await pollOverallAnalysis('job-no-key');

            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 저장을 건너뛴다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            const result = await pollOverallAnalysis('job-no-provider');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('빈 응답이 감지되면 경고를 로그하고 done을 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(JSON.stringify({}));
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const result = await pollOverallAnalysis('job-empty');

            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[PollOverall] Empty overall analysis',
                { jobId: 'job-empty' }
            );
            warnSpy.mockRestore();
        });

        it('echoes meta.optionsOiStale onto response.optionsOiStale', async () => {
            // The stale-OI flag is captured at submit time and stashed in the
            // job meta so the normalizer can attach it to the worker response
            // without round-tripping through the LLM payload. Verify the
            // end-to-end echo: meta.optionsOiStale=true → result.optionsOiStale=true.
            mockGetJobMeta.mockResolvedValueOnce({
                ...mockMeta,
                optionsOiStale: true,
            });
            mockGetJobResult.mockResolvedValueOnce(rawOverallJson);

            const result = await pollOverallAnalysis('job-stale');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.optionsOiStale).toBe(true);
            }
        });
    });
});
