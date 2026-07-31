import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');

import { dispatchWorkerJob } from '@/application/workerDispatch';
import {
    getJobStatus,
    setJobError,
    setJobStatus,
} from '@/infrastructure/jobs/queue';

const mockGetJobStatus = getJobStatus as Mock;
const mockSetJobStatus = setJobStatus as Mock;
const mockSetJobError = setJobError as Mock;
const mockFetch = vi.fn();

const DISPATCH_URL = 'https://worker.test/analyze';
const DISPATCH_INIT: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-1' }),
};

describe('dispatchWorkerJob 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        // Default: no prior job status recorded (mirrors a never-touched
        // job) so the read-before-write clobber guard lets the error write
        // through in every test that does not explicitly override it.
        mockGetJobStatus.mockResolvedValue(null);
        mockSetJobStatus.mockResolvedValue(undefined);
        mockSetJobError.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('워커가 2xx를 반환할 때', () => {
        it('job 에러 상태를 쓰지 않는다', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('{}', { status: 200 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-1',
                '[Test]'
            );

            expect(mockSetJobStatus).not.toHaveBeenCalled();
            expect(mockSetJobError).not.toHaveBeenCalled();
        });
    });

    describe('워커가 non-2xx를 반환할 때 (worker rejection)', () => {
        it('job 상태를 error로, 에러 메시지를 setJobError로 기록한다 — poll이 프로세싱 무한루프에 빠지지 않도록', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'invalid model' }), {
                    status: 400,
                })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-1',
                '[Test]'
            );

            expect(mockSetJobStatus).toHaveBeenCalledWith('job-1', 'error');
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-1',
                expect.stringContaining('400')
            );
            // Exact-match pin for round-2's logPrefix fix: the message
            // stored via setJobError (surfaced to the consumer as
            // result.error) must NOT carry the internal `[Test]` log
            // prefix — only the console.error line below should. A
            // stringContaining('400') assertion alone would still pass if
            // the prefix leaked back in (e.g. '[Test] Worker rejected job
            // (status 400)'), so this makes that regression falsifiable.
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-1',
                'Worker rejected job (status 400)'
            );
            // Order matters, and mirrors the worker's own order (queue.ts:
            // setJobError is "called by the worker immediately before
            // transitioning the status to `error`"). These are two separate
            // Upstash round-trips, and pollAnalysis reads status first, then
            // falls back to getJobError() ?? 'Unknown error' once status is
            // 'error'. Writing status before the message would let a poll
            // land in between and observe status==='error' with no message
            // yet, discarding the specific failure reason — the whole point
            // of this fix. Message-first makes that window benign instead
            // (status still absent, so poll treats it as 'processing').
            const errorCallOrder = mockSetJobError.mock.invocationCallOrder[0];
            const statusCallOrder =
                mockSetJobStatus.mock.invocationCallOrder[0];
            expect(errorCallOrder).toBeLessThan(statusCallOrder);
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Test] Worker rejected job:',
                'job-1',
                400,
                expect.stringContaining('invalid model')
            );
            consoleSpy.mockRestore();
        });

        it('5xx도 동일하게 error 상태로 기록한다', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockFetch.mockResolvedValueOnce(
                new Response('Internal Server Error', { status: 503 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-2',
                '[Test]'
            );

            expect(mockSetJobStatus).toHaveBeenCalledWith('job-2', 'error');
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-2',
                expect.stringContaining('503')
            );
        });

        it('응답 본문이 길면 콘솔 로그에서 500자로 잘린다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const longBody = 'x'.repeat(2000);
            mockFetch.mockResolvedValueOnce(
                new Response(longBody, { status: 400 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-3',
                '[Test]'
            );

            const loggedBody = consoleSpy.mock.calls[0]?.[3] as string;
            expect(loggedBody.length).toBe(500);
            consoleSpy.mockRestore();
        });

        it('response.text()가 실패해도 에러 상태 기록은 계속 진행한다', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const brokenResponse = {
                ok: false,
                status: 500,
                text: () => Promise.reject(new Error('body read failed')),
            } as unknown as Response;
            mockFetch.mockResolvedValueOnce(brokenResponse);

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-4',
                '[Test]'
            );

            expect(mockSetJobStatus).toHaveBeenCalledWith('job-4', 'error');
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-4',
                expect.stringContaining('500')
            );
        });
    });

    describe('네트워크 레벨에서 fetch 자체가 reject할 때', () => {
        it('콘솔에 로깅하고 동일하게 job을 error 상태로 기록한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetch.mockRejectedValueOnce(new Error('network down'));

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-5',
                '[Test]'
            );

            expect(consoleSpy).toHaveBeenCalledWith(
                '[Test] Worker request failed:',
                expect.any(Error)
            );
            expect(mockSetJobStatus).toHaveBeenCalledWith('job-5', 'error');
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-5',
                expect.stringContaining('network down')
            );
            consoleSpy.mockRestore();
        });
    });

    describe('에러 값 자체가 String() 변환에서 throw할 때 (null-prototype 등)', () => {
        it('fetch가 Object.create(null)로 reject해도 반환된 promise는 resolve하고 job은 error 상태에 도달한다', async () => {
            // String(Object.create(null)) itself throws TypeError (no
            // toString/valueOf to fall back to) — a bare `String(error)` at
            // this call site would let that TypeError escape dispatchWorkerJob
            // as a rejection, straight into fireAndForget with no .catch()
            // attached at any of the 13 call sites. This is not purely
            // theoretical against undici (which rejects with TypeError/
            // DOMException), but a stubbed/instrumented global fetch — as
            // used by this very test file — can reject with anything.
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetch.mockRejectedValueOnce(Object.create(null));

            await expect(
                dispatchWorkerJob(
                    DISPATCH_URL,
                    DISPATCH_INIT,
                    'job-14',
                    '[Test]'
                )
            ).resolves.toBeUndefined();

            expect(mockSetJobStatus).toHaveBeenCalledWith('job-14', 'error');
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-14',
                expect.stringContaining('Worker request failed')
            );
            consoleSpy.mockRestore();
        });

        it('response 검사 도중 Object.create(null)이 throw돼도 반환된 promise는 resolve하고 job은 error 상태에 도달한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const notARealResponse = {
                get ok(): boolean {
                    // Deliberately non-Error thrown value, to exercise the
                    // safe-stringify fallback (see safeStringifyError).
                    throw Object.create(null);
                },
            } as unknown as Response;
            mockFetch.mockResolvedValueOnce(notARealResponse);

            await expect(
                dispatchWorkerJob(
                    DISPATCH_URL,
                    DISPATCH_INIT,
                    'job-15',
                    '[Test]'
                )
            ).resolves.toBeUndefined();

            expect(mockSetJobStatus).toHaveBeenCalledWith('job-15', 'error');
            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-15',
                expect.stringContaining('Worker response inspection failed')
            );
            consoleSpy.mockRestore();
        });
    });

    describe('job store 쓰기 자체가 실패할 때', () => {
        it('setJobError가 reject해도 반환된 promise는 resolve한다 — fireAndForget에 waitUntil 없이 넘겨도 unhandled rejection이 되지 않는다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetch.mockResolvedValueOnce(
                new Response('server error', { status: 500 })
            );
            mockSetJobError.mockRejectedValueOnce(
                new Error('Upstash REST unavailable')
            );

            await expect(
                dispatchWorkerJob(
                    DISPATCH_URL,
                    DISPATCH_INIT,
                    'job-6',
                    '[Test]'
                )
            ).resolves.toBeUndefined();

            expect(consoleSpy).toHaveBeenCalledWith(
                '[Test] Failed to record job error state:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it('setJobError가 reject해도 setJobStatus는 여전히 호출된다 — 두 쓰기가 하나의 try/catch를 공유하면 setJobError 실패가 setJobStatus 시도 자체를 건너뛰어, 잡에 상태가 전혀 안 남고 poll이 processing에서 영원히 멈춘다 (fail-closed 회귀 테스트)', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetch.mockResolvedValueOnce(
                new Response('server error', { status: 500 })
            );
            mockSetJobError.mockRejectedValueOnce(
                new Error('Upstash REST unavailable')
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-6b',
                '[Test]'
            );

            // Even though the message write (setJobError) failed, the status
            // write must still be attempted — otherwise the job is left with
            // NO status at all, and pollAnalysis treats an absent status as
            // 'processing' forever (poll* then falls back to
            // getJobError() ?? 'Unknown error' once status is 'error', so a
            // generic terminal error is strictly better than a silent hang).
            expect(mockSetJobStatus).toHaveBeenCalledWith('job-6b', 'error');
            consoleSpy.mockRestore();
        });

        it('setJobStatus가 reject해도 반환된 promise는 resolve한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetch.mockRejectedValueOnce(new Error('network down'));
            mockSetJobStatus.mockRejectedValueOnce(
                new Error('Upstash REST unavailable')
            );

            await expect(
                dispatchWorkerJob(
                    DISPATCH_URL,
                    DISPATCH_INIT,
                    'job-7',
                    '[Test]'
                )
            ).resolves.toBeUndefined();

            consoleSpy.mockRestore();
        });
    });

    describe('워커가 이미 잡을 완료 처리했을 때 (응답 유실)', () => {
        it('status가 이미 done이면 error로 덮어쓰지 않는다', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            // Simulates a lost response: the worker finished and wrote
            // `done` before the HTTP response reached this dispatcher (e.g.
            // a connection reset, an ALB/CDN 502/504, or the 5-minute
            // AbortSignal.timeout firing after the worker already completed).
            mockGetJobStatus.mockResolvedValueOnce('done');
            mockFetch.mockResolvedValueOnce(
                new Response('gateway timeout', { status: 504 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-8',
                '[Test]'
            );

            expect(mockSetJobError).not.toHaveBeenCalled();
            expect(mockSetJobStatus).not.toHaveBeenCalled();
        });

        it('status가 이미 worker 자신이 쓴 error이면 다시 쓰지 않는다', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockFetch.mockResolvedValueOnce(
                new Response('gateway timeout', { status: 504 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-9',
                '[Test]'
            );

            expect(mockSetJobError).not.toHaveBeenCalled();
            expect(mockSetJobStatus).not.toHaveBeenCalled();
        });

        it('status가 processing이면 정상적으로 error로 기록한다 (클로버 가드는 processing을 막지 않는다)', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockGetJobStatus.mockResolvedValueOnce('processing');
            mockFetch.mockResolvedValueOnce(
                new Response('gateway timeout', { status: 504 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-10',
                '[Test]'
            );

            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-10',
                expect.stringContaining('504')
            );
            expect(mockSetJobStatus).toHaveBeenCalledWith('job-10', 'error');
        });

        it('getJobStatus 조회 자체가 reject해도 클로버 가드가 이를 삼키지 않고 error 기록을 계속 시도한다 (fail-open 회귀 테스트)', async () => {
            // Regression test for round-2's own fix: a transient failure on
            // the READ alone (an Upstash 5xx / network blip on that one
            // round-trip) must not suppress the writes below it. A shared
            // try/catch around the read and the writes would swallow this
            // and leave the job with no terminal state — every poll* would
            // spin in 'processing' forever, which is exactly the bug this
            // whole branch exists to remove.
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockGetJobStatus.mockRejectedValueOnce(
                new Error('Upstash REST unavailable')
            );
            mockFetch.mockResolvedValueOnce(
                new Response('gateway timeout', { status: 504 })
            );

            await dispatchWorkerJob(
                DISPATCH_URL,
                DISPATCH_INIT,
                'job-11',
                '[Test]'
            );

            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-11',
                expect.stringContaining('504')
            );
            expect(mockSetJobStatus).toHaveBeenCalledWith('job-11', 'error');
        });
    });

    describe('워커가 실제 Response 아닌 값으로 resolve할 때 (스텁/폴리필/테스트 더블)', () => {
        it('response.ok/response.text 접근이 동기적으로 throw해도 반환된 promise는 resolve한다', async () => {
            // Guards the "never rejects" invariant documented on
            // dispatchWorkerJob: `fetch` resolving does not guarantee the
            // resolved value behaves like a spec Response. A resolved value
            // where `.ok` access itself throws (e.g. via a getter) must not
            // let that throw propagate out of this async function into
            // fireAndForget with no .catch() attached.
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const notARealResponse = {
                get ok(): boolean {
                    throw new TypeError('ok is not a function');
                },
            } as unknown as Response;
            mockFetch.mockResolvedValueOnce(notARealResponse);

            await expect(
                dispatchWorkerJob(
                    DISPATCH_URL,
                    DISPATCH_INIT,
                    'job-12',
                    '[Test]'
                )
            ).resolves.toBeUndefined();

            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-12',
                expect.stringContaining('ok is not a function')
            );
            expect(mockSetJobStatus).toHaveBeenCalledWith('job-12', 'error');
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Test] Worker response inspection failed:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it('response.text가 함수가 아니어서 throw해도 반환된 promise는 resolve한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const notARealResponse = {
                ok: false,
                status: 500,
                text: 'not-a-function',
            } as unknown as Response;
            mockFetch.mockResolvedValueOnce(notARealResponse);

            await expect(
                dispatchWorkerJob(
                    DISPATCH_URL,
                    DISPATCH_INIT,
                    'job-13',
                    '[Test]'
                )
            ).resolves.toBeUndefined();

            expect(mockSetJobError).toHaveBeenCalledWith(
                'job-13',
                expect.stringContaining('is not a function')
            );
            expect(mockSetJobStatus).toHaveBeenCalledWith('job-13', 'error');
            consoleSpy.mockRestore();
        });
    });
});
