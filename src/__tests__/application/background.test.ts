import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');

import { cleanupInBackground, fireAndForget } from '@/application/background';
import {
    cleanupJob,
    clearInFlightJob,
    getJobMeta,
} from '@/infrastructure/jobs/queue';

const mockCleanupJob = cleanupJob as Mock;
const mockClearInFlightJob = clearInFlightJob as Mock;
const mockGetJobMeta = getJobMeta as Mock;

describe('background helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCleanupJob.mockResolvedValue(undefined);
        mockClearInFlightJob.mockResolvedValue(undefined);
        mockGetJobMeta.mockResolvedValue(null);
    });

    it('fireAndForget은 waitUntil이 있으면 promise를 등록한다', () => {
        const promise = Promise.resolve();
        const waitUntil = vi.fn();

        fireAndForget(promise, { waitUntil });

        expect(waitUntil).toHaveBeenCalledWith(promise);
    });

    it('cleanupInBackground는 cleanupJob promise를 waitUntil에 등록한다', () => {
        const waitUntil = vi.fn();

        cleanupInBackground('job-1', '[Test]', { waitUntil });

        expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });

    it('cleanupInBackground는 meta의 cacheKey로 in-flight slot을 해제한다', async () => {
        let registered: Promise<unknown> | undefined;
        const waitUntil = vi.fn((promise: Promise<unknown>) => {
            registered = promise;
        });
        mockGetJobMeta.mockResolvedValue({
            symbol: 'AAPL',
            cacheKey: 'cache-key',
        });

        cleanupInBackground('job-1', '[Test]', { waitUntil });
        await registered;

        expect(mockGetJobMeta).toHaveBeenCalledWith('job-1');
        expect(mockClearInFlightJob).toHaveBeenCalledWith('job-1', 'cache-key');
        expect(mockCleanupJob).toHaveBeenCalledWith('job-1');
    });

    it('cleanupInBackground는 meta read 실패 시에도 cleanupJob을 호출한다', async () => {
        let registered: Promise<unknown> | undefined;
        const waitUntil = vi.fn((promise: Promise<unknown>) => {
            registered = promise;
        });
        mockGetJobMeta.mockRejectedValue(new Error('redis down'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        cleanupInBackground('job-1', '[Test]', { waitUntil });
        await registered;

        expect(warnSpy).toHaveBeenCalledWith(
            '[Test] cleanup meta read failed:',
            expect.any(Error)
        );
        expect(mockClearInFlightJob).toHaveBeenCalledWith('job-1', undefined);
        expect(mockCleanupJob).toHaveBeenCalledWith('job-1');

        warnSpy.mockRestore();
    });

    it('cleanupInBackground는 meta가 null로 resolve되면 경고 없이 정리만 진행한다', async () => {
        let registered: Promise<unknown> | undefined;
        const waitUntil = vi.fn((promise: Promise<unknown>) => {
            registered = promise;
        });
        // meta가 TTL 만료 등으로 사라진 상태(에러는 아님). 경고 로그가 발생하지
        // 않아야 reject 분기와 동작이 구분된다.
        mockGetJobMeta.mockResolvedValue(null);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        cleanupInBackground('job-1', '[Test]', { waitUntil });
        await registered;

        expect(warnSpy).not.toHaveBeenCalled();
        expect(mockClearInFlightJob).toHaveBeenCalledWith('job-1', undefined);
        expect(mockCleanupJob).toHaveBeenCalledWith('job-1');

        warnSpy.mockRestore();
    });
});
