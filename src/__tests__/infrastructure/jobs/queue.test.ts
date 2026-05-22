import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { SECONDS_PER_HOUR } from '@/domain/constants/time';
import type { JobMeta } from '@/infrastructure/jobs/types';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock('@/infrastructure/jobs/redis', () => ({
    createJobStateStore: vi.fn(),
}));

import { createJobStateStore } from '@/infrastructure/jobs/redis';
import {
    cancelJob,
    cleanupJob,
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
    isJobCancelled,
    setJobError,
    setJobMeta,
    setJobResult,
    setJobStatus,
} from '@/infrastructure/jobs/queue';

// vi.mock이 createJobStateStore를 vi.fn()으로 교체하므로 Mock API(mockReturnValue 등) 접근을 위해 캐스트
const mockCreateJobStateStore = createJobStateStore as Mock;

const fakeStore = {
    get: mockGet,
    set: mockSet,
    deleteMany: mockDeleteMany,
};

describe('job queue — store null (env vars missing)', () => {
    beforeEach(() => {
        mockCreateJobStateStore.mockReturnValue(null);
        mockGet.mockClear();
        mockSet.mockClear();
        mockDeleteMany.mockClear();
    });

    it('setJobMeta returns without calling store', async () => {
        await setJobMeta('job1', {
            symbol: 'AAPL',
            timeframe: '1Hour',
            skillsDegraded: false,
        });
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('setJobStatus returns without calling store', async () => {
        await setJobStatus('job1', 'processing');
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('setJobResult returns without calling store', async () => {
        await setJobResult('job1', { score: 1 });
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('setJobError returns without calling store', async () => {
        await setJobError('job1', 'Something went wrong');
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('getJobStatus returns null', async () => {
        expect(await getJobStatus('job1')).toBeNull();
    });

    it('getJobResult returns null', async () => {
        expect(await getJobResult('job1')).toBeNull();
    });

    it('getJobError returns null', async () => {
        expect(await getJobError('job1')).toBeNull();
    });

    it('getJobMeta returns null', async () => {
        expect(await getJobMeta('job1')).toBeNull();
    });

    it('cancelJob returns without calling store', async () => {
        await cancelJob('job1');
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('isJobCancelled returns false', async () => {
        expect(await isJobCancelled('job1')).toBe(false);
    });

    it('cleanupJob returns without calling store', async () => {
        await cleanupJob('job1');
        expect(mockDeleteMany).not.toHaveBeenCalled();
    });
});

describe('job queue — with store', () => {
    beforeEach(() => {
        mockCreateJobStateStore.mockReturnValue(fakeStore);
        mockGet.mockClear();
        mockSet.mockClear();
        mockDeleteMany.mockClear();
    });

    it('setJobMeta calls store.set with correct key and TTL', async () => {
        mockSet.mockResolvedValue(undefined);
        const meta: JobMeta = {
            symbol: 'AAPL',
            timeframe: '1Hour',
            skillsDegraded: false,
        };
        await setJobMeta('job1', meta);
        expect(mockSet).toHaveBeenCalledWith('job:job1:meta', meta, {
            ttlSeconds: SECONDS_PER_HOUR,
        });
    });

    it('getJobStatus calls store.get with status key', async () => {
        mockGet.mockResolvedValue('processing');
        const result = await getJobStatus('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:status');
        expect(result).toBe('processing');
    });

    it('getJobResult calls store.get with result key', async () => {
        mockGet.mockResolvedValue({ score: 42 });
        const result = await getJobResult('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:result');
        expect(result).toEqual({ score: 42 });
    });

    it('getJobError calls store.get with error key', async () => {
        mockGet.mockResolvedValue('Something went wrong');
        const result = await getJobError('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:error');
        expect(result).toBe('Something went wrong');
    });

    it('getJobMeta calls store.get with meta key', async () => {
        const meta: JobMeta = {
            symbol: 'TSLA',
            timeframe: '4Hour',
            skillsDegraded: true,
        };
        mockGet.mockResolvedValue(meta);
        const result = await getJobMeta('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:meta');
        expect(result).toEqual(meta);
    });

    it('cancelJob calls store.set with cancelled key', async () => {
        mockSet.mockResolvedValue(undefined);
        await cancelJob('job1');
        expect(mockSet).toHaveBeenCalledWith('job:job1:cancelled', '1', {
            ttlSeconds: SECONDS_PER_HOUR,
        });
    });

    it('isJobCancelled returns true when value is "1"', async () => {
        mockGet.mockResolvedValue('1');
        expect(await isJobCancelled('job1')).toBe(true);
    });

    it('isJobCancelled returns false when value is null', async () => {
        mockGet.mockResolvedValue(null);
        expect(await isJobCancelled('job1')).toBe(false);
    });

    it('isJobCancelled returns false when value is not "1"', async () => {
        mockGet.mockResolvedValue('0');
        expect(await isJobCancelled('job1')).toBe(false);
    });

    it('cleanupJob calls store.deleteMany with all job keys', async () => {
        mockDeleteMany.mockResolvedValue(5);
        await cleanupJob('job1');
        expect(mockDeleteMany).toHaveBeenCalledWith(
            'job:job1:status',
            'job:job1:result',
            'job:job1:error',
            'job:job1:meta',
            'job:job1:cancelled'
        );
    });

    it('setJobStatus calls store.set with status key', async () => {
        mockSet.mockResolvedValue(undefined);
        await setJobStatus('job1', 'processing');
        expect(mockSet).toHaveBeenCalledWith('job:job1:status', 'processing', {
            ttlSeconds: SECONDS_PER_HOUR,
        });
    });

    it('setJobResult calls store.set with result key', async () => {
        mockSet.mockResolvedValue(undefined);
        await setJobResult('job1', { score: 42 });
        expect(mockSet).toHaveBeenCalledWith(
            'job:job1:result',
            { score: 42 },
            { ttlSeconds: SECONDS_PER_HOUR }
        );
    });

    it('setJobError calls store.set with error key', async () => {
        mockSet.mockResolvedValue(undefined);
        await setJobError('job1', 'Something went wrong');
        expect(mockSet).toHaveBeenCalledWith(
            'job:job1:error',
            'Something went wrong',
            { ttlSeconds: SECONDS_PER_HOUR }
        );
    });
});
