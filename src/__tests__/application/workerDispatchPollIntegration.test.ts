import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type {
    JobStateSetOpts,
    JobStateStore,
} from '@/domain/ports/jobStateStore';

/**
 * Integration test for FIX 1 (dispatch-error-and-congress-byok): a non-2xx
 * (or network-failed) worker dispatch must leave the job in the SAME
 * `error` state a worker itself writes on a mid-job failure, so `poll*`
 * reports it instead of looping forever on an absent status.
 *
 * Deliberately does NOT mock `@/infrastructure/jobs/queue` — the whole point
 * is to exercise the real `setJobStatus`/`setJobError`/`getJobStatus`/
 * `getJobError` round-trip that `dispatchWorkerJob` and `pollAnalysis` share.
 * Only the underlying Upstash adapter factory (`@/infrastructure/jobs/redis`)
 * is replaced with an in-memory fake, so both sides of the fix talk to the
 * same store without a real Redis dependency.
 */
vi.mock('@/infrastructure/jobs/redis', () => ({
    createJobStateStore: vi.fn(),
}));

import { dispatchWorkerJob } from '@/application/workerDispatch';
import { pollAnalysis } from '@/application/market/pollAnalysis';
import { createJobStateStore } from '@/infrastructure/jobs/redis';

const mockCreateJobStateStore = createJobStateStore as Mock;
const mockFetch = vi.fn();

/** Minimal in-memory {@link JobStateStore} — real `set`/`get`/`deleteMany` semantics, no Upstash. */
class FakeJobStateStore implements JobStateStore {
    private readonly data = new Map<string, unknown>();

    async get<T>(key: string): Promise<T | null> {
        return this.data.has(key) ? (this.data.get(key) as T) : null;
    }

    async set<T>(key: string, value: T, _opts: JobStateSetOpts): Promise<void> {
        this.data.set(key, value);
    }

    async deleteMany(...keys: string[]): Promise<number> {
        let removed = 0;
        for (const key of keys) {
            if (this.data.delete(key)) removed += 1;
        }
        return removed;
    }
}

describe('worker dispatch 실패 → poll이 error를 보고한다 (통합)', () => {
    let fakeStore: FakeJobStateStore;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        fakeStore = new FakeJobStateStore();
        mockCreateJobStateStore.mockReturnValue(fakeStore);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('워커가 400을 반환하면 — 이전에는 무한 processing으로 방치되던 잡이 — poll이 status: error를 반환한다', async () => {
        const jobId = 'integration-job-400';
        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: 'bad request' }), {
                status: 400,
            })
        );

        // Before the fix this resolved silently and left no job state at all —
        // pollAnalysis would then treat the absent status as 'processing'
        // forever (infinite spinner).
        await dispatchWorkerJob(
            'https://worker.test/analyze',
            { method: 'POST', body: '{}' },
            jobId,
            '[IntegrationTest]'
        );

        const polled = await pollAnalysis(jobId);

        expect(polled.status).toBe('error');
        if (polled.status === 'error') {
            expect(polled.error).toContain('400');
        }
    });

    it('워커가 500을 반환해도 동일하게 poll이 status: error를 반환한다', async () => {
        const jobId = 'integration-job-500';
        mockFetch.mockResolvedValueOnce(
            new Response('upstream unavailable', { status: 500 })
        );

        await dispatchWorkerJob(
            'https://worker.test/analyze',
            { method: 'POST', body: '{}' },
            jobId,
            '[IntegrationTest]'
        );

        const polled = await pollAnalysis(jobId);

        expect(polled.status).toBe('error');
    });

    it('fetch 자체가 네트워크 레벨에서 reject해도 poll이 status: error를 반환한다', async () => {
        const jobId = 'integration-job-network-fail';
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        await dispatchWorkerJob(
            'https://worker.test/analyze',
            { method: 'POST', body: '{}' },
            jobId,
            '[IntegrationTest]'
        );

        const polled = await pollAnalysis(jobId);

        expect(polled.status).toBe('error');
    });

    it('워커가 2xx를 반환하면 job 상태를 쓰지 않으므로 poll은 여전히 processing이다 (정상 fire-and-forget 유지)', async () => {
        const jobId = 'integration-job-ok';
        mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));

        await dispatchWorkerJob(
            'https://worker.test/analyze',
            { method: 'POST', body: '{}' },
            jobId,
            '[IntegrationTest]'
        );

        // No status was ever written (the worker itself is responsible for
        // writing 'processing'/'done' once it picks up the job) — pollAnalysis
        // treats an absent status as 'processing', exactly as before the fix.
        const polled = await pollAnalysis(jobId);

        expect(polled.status).toBe('processing');
    });
});
