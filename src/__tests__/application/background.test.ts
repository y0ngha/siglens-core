import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');

import { cleanupInBackground, fireAndForget } from '@/application/background';
import { cleanupJob } from '@/infrastructure/jobs/queue';

const mockCleanupJob = cleanupJob as Mock;

describe('background helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCleanupJob.mockResolvedValue(undefined);
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

        expect(mockCleanupJob).toHaveBeenCalledWith('job-1');
        expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });
});
