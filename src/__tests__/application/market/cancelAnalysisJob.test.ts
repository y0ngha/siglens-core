import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');

import { cancelAnalysisJob } from '@/application/market/cancelAnalysisJob';
import { cancelJob } from '@/infrastructure/jobs/queue';

const mockCancelJob = cancelJob as Mock;
const mockFetch = vi.fn<() => Promise<Response>>();

describe('cancelAnalysisJob', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        mockCancelJob.mockReset();
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
