import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');

import { cancelAnalysisJob } from '@/application/market/cancelAnalysisJob';
import {
    cancelJob,
    clearInFlightJob,
    getJobMeta,
    releaseInFlightJob,
} from '@/infrastructure/jobs/queue';

const mockCancelJob = cancelJob as Mock;
const mockReleaseInFlightJob = releaseInFlightJob as Mock;
const mockClearInFlightJob = clearInFlightJob as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockFetch = vi.fn<() => Promise<Response>>();

describe('cancelAnalysisJob', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        mockCancelJob.mockReset();
        mockReleaseInFlightJob.mockReset();
        mockClearInFlightJob.mockReset();
        mockGetJobMeta.mockReset();
        // Default: every cancel is the last subscriber so legacy behavior is
        // exercised. Refcount-aware tests override per-test.
        mockReleaseInFlightJob.mockResolvedValue(true);
        mockClearInFlightJob.mockResolvedValue(undefined);
        mockGetJobMeta.mockResolvedValue(null);
        mockFetch.mockReset();
        global.fetch = mockFetch;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        global.fetch = originalFetch;
        delete process.env.WORKER_URL;
        delete process.env.WORKER_SECRET;
        vi.restoreAllMocks();
    });

    it('cancelJob에 jobId를 전달한다', async () => {
        mockCancelJob.mockResolvedValueOnce(undefined);

        await cancelAnalysisJob('job-abc');

        expect(mockCancelJob).toHaveBeenCalledWith('job-abc');
    });

    it('cancelJob이 실패해도 에러를 전파하지 않는다 (fire-and-forget)', async () => {
        mockCancelJob.mockRejectedValueOnce(new Error('Redis error'));

        await expect(cancelAnalysisJob('job-fail')).resolves.toBeUndefined();
    });

    it('cancelJob이 실패하면 경고 로그를 남긴다', async () => {
        mockCancelJob.mockRejectedValueOnce(new Error('Redis error'));

        await cancelAnalysisJob('job-fail');

        expect(console.warn).toHaveBeenCalledWith(
            '[cancelAnalysisJob] Failed to signal cancellation:',
            'job-fail',
            expect.any(Error)
        );
    });

    describe('WORKER_URL/WORKER_SECRET 설정 시', () => {
        beforeEach(() => {
            process.env.WORKER_URL = 'https://worker.test';
            process.env.WORKER_SECRET = 'test-secret';
            mockCancelJob.mockResolvedValue(undefined);
            mockFetch.mockResolvedValue(
                new Response(JSON.stringify({ status: 'ok' }))
            );
        });

        afterEach(() => {
            delete process.env.WORKER_URL;
            delete process.env.WORKER_SECRET;
        });

        it('워커 /cancel 엔드포인트에 POST 요청을 보낸다', async () => {
            await cancelAnalysisJob('job-xyz');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://worker.test/cancel',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'X-Worker-Secret': 'test-secret',
                    }),
                    body: JSON.stringify({ jobId: 'job-xyz' }),
                    signal: expect.any(AbortSignal),
                })
            );
        });

        it('waitUntil이 제공되면 워커 /cancel 요청 promise를 등록한다', async () => {
            const waitUntil = vi.fn();

            await cancelAnalysisJob('job-xyz', { waitUntil });

            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });

        it('fetch 실패해도 에러를 전파하지 않는다', async () => {
            mockFetch.mockRejectedValueOnce(new Error('network error'));

            await expect(
                cancelAnalysisJob('job-net-fail')
            ).resolves.toBeUndefined();
        });

        it('fetch 실패 시 경고 로그를 남긴다', async () => {
            mockFetch.mockRejectedValueOnce(new Error('network error'));

            await cancelAnalysisJob('job-net-fail');

            expect(console.warn).toHaveBeenCalledWith(
                '[cancelAnalysisJob] Failed to signal cancellation:',
                'job-net-fail',
                expect.any(Error)
            );
        });
    });

    describe('refcount semantics', () => {
        beforeEach(() => {
            process.env.WORKER_URL = 'https://worker.test';
            process.env.WORKER_SECRET = 'test-secret';
            // worker URL이 설정된 분기에서는 fetch가 호출되므로 기본 응답 제공.
            mockFetch.mockResolvedValue(
                new Response(JSON.stringify({ status: 'ok' }))
            );
        });

        afterEach(() => {
            delete process.env.WORKER_URL;
            delete process.env.WORKER_SECRET;
        });

        it('마지막 구독자가 아닐 때 cancelJob과 fetch를 호출하지 않는다', async () => {
            mockReleaseInFlightJob.mockResolvedValueOnce(false);

            await cancelAnalysisJob('shared-job');

            expect(mockReleaseInFlightJob).toHaveBeenCalledWith('shared-job');
            expect(mockCancelJob).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('마지막 구독자일 때 cancelJob을 호출한다', async () => {
            mockReleaseInFlightJob.mockResolvedValueOnce(true);
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('last-job');

            expect(mockReleaseInFlightJob).toHaveBeenCalledWith('last-job');
            expect(mockCancelJob).toHaveBeenCalledWith('last-job');
        });

        it('마지막 구독자 cancel 시 cacheKey로 인플라이트 슬롯을 정리한다', async () => {
            mockReleaseInFlightJob.mockResolvedValueOnce(true);
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                cacheKey: 'cache-abc',
            });
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('last-job');

            expect(mockClearInFlightJob).toHaveBeenCalledWith(
                'last-job',
                'cache-abc'
            );
            expect(mockCancelJob).toHaveBeenCalledWith('last-job');
            // 슬롯 정리는 cancelJob 신호 전에 수행되어야 한다 — 그래야 같은
            // 입력의 신규 submitter가 이 취소된 jobId에 join되는 회귀가 없다.
            // invocationCallOrder는 vitest mock이 호출된 글로벌 순번이므로
            // 작은 값일수록 먼저 호출됨을 보장한다.
            const clearOrder =
                mockClearInFlightJob.mock.invocationCallOrder[0];
            const cancelOrder = mockCancelJob.mock.invocationCallOrder[0];
            expect(clearOrder).toBeLessThan(cancelOrder);
        });

        it('마지막 구독자 cancel 시 meta 조회가 실패해도 cancel은 진행된다', async () => {
            mockReleaseInFlightJob.mockResolvedValueOnce(true);
            mockGetJobMeta.mockRejectedValueOnce(new Error('Redis down'));
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('last-job');

            // cacheKey 없이도 호출하여 refcount 키만이라도 정리한다.
            expect(mockClearInFlightJob).toHaveBeenCalledWith(
                'last-job',
                undefined
            );
            expect(mockCancelJob).toHaveBeenCalledWith('last-job');
        });

        it('refcount 조회가 실패하면 안전하게 cancel을 전파한다', async () => {
            mockReleaseInFlightJob.mockRejectedValueOnce(
                new Error('Redis down')
            );
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('redis-fail-job');

            expect(mockCancelJob).toHaveBeenCalledWith('redis-fail-job');
            expect(console.warn).toHaveBeenCalledWith(
                '[cancelAnalysisJob] Failed to release subscriber refcount:',
                'redis-fail-job',
                expect.any(Error)
            );
        });
    });

    describe('WORKER_URL/WORKER_SECRET 미설정 시', () => {
        it('fetch를 호출하지 않는다', async () => {
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('job-no-worker');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('WORKER_URL만 설정된 경우 fetch를 호출하지 않는다', async () => {
            process.env.WORKER_URL = 'https://worker.test';
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('job-partial');

            expect(mockFetch).not.toHaveBeenCalled();
            delete process.env.WORKER_URL;
        });

        it('WORKER_SECRET만 설정된 경우 fetch를 호출하지 않는다', async () => {
            process.env.WORKER_SECRET = 'test-secret';
            mockCancelJob.mockResolvedValueOnce(undefined);

            await cancelAnalysisJob('job-partial');

            expect(mockFetch).not.toHaveBeenCalled();
            delete process.env.WORKER_SECRET;
        });
    });
});
