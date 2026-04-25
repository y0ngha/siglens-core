import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { SECONDS_PER_HOUR } from '@/domain/constants/time';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();

vi.mock('@/infrastructure/jobs/redis', () => ({
    createJobRedis: vi.fn(),
}));

import { createJobRedis } from '@/infrastructure/jobs/redis';
import {
    cancelJob,
    cleanupJob,
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
    isJobCancelled,
    setJobMeta,
} from '@/infrastructure/jobs/queue';

const mockCreateJobRedis = createJobRedis as Mock;

const fakeRedis = {
    get: mockGet,
    set: mockSet,
    del: mockDel,
};

describe('job queue — redis null (env vars missing)', () => {
    beforeEach(() => {
        mockCreateJobRedis.mockReturnValue(null);
        mockGet.mockClear();
        mockSet.mockClear();
        mockDel.mockClear();
    });

    it('setJobMeta returns without calling redis', async () => {
        await setJobMeta('job1', {
            symbol: 'AAPL',
            timeframe: '1Hour',
            skillsDegraded: false,
        });
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

    it('cancelJob returns without calling redis', async () => {
        await cancelJob('job1');
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('isJobCancelled returns false', async () => {
        expect(await isJobCancelled('job1')).toBe(false);
    });

    it('cleanupJob returns without calling redis', async () => {
        await cleanupJob('job1');
        expect(mockDel).not.toHaveBeenCalled();
    });
});

describe('job queue — with redis', () => {
    beforeEach(() => {
        mockCreateJobRedis.mockReturnValue(fakeRedis);
        mockGet.mockClear();
        mockSet.mockClear();
        mockDel.mockClear();
    });

    it('setJobMeta calls redis.set with correct key and TTL', async () => {
        mockSet.mockResolvedValue('OK');
        const meta = { symbol: 'AAPL', timeframe: '1Hour' as const, skillsDegraded: false };
        await setJobMeta('job1', meta);
        expect(mockSet).toHaveBeenCalledWith('job:job1:meta', meta, { ex: SECONDS_PER_HOUR });
    });

    it('getJobStatus calls redis.get with status key', async () => {
        mockGet.mockResolvedValue('processing');
        const result = await getJobStatus('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:status');
        expect(result).toBe('processing');
    });

    it('getJobResult calls redis.get with result key', async () => {
        mockGet.mockResolvedValue({ score: 42 });
        const result = await getJobResult('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:result');
        expect(result).toEqual({ score: 42 });
    });

    it('getJobError calls redis.get with error key', async () => {
        mockGet.mockResolvedValue('Something went wrong');
        const result = await getJobError('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:error');
        expect(result).toBe('Something went wrong');
    });

    it('getJobMeta calls redis.get with meta key', async () => {
        const meta = { symbol: 'TSLA', timeframe: '4Hour' as const, skillsDegraded: true };
        mockGet.mockResolvedValue(meta);
        const result = await getJobMeta('job1');
        expect(mockGet).toHaveBeenCalledWith('job:job1:meta');
        expect(result).toEqual(meta);
    });

    it('cancelJob calls redis.set with cancelled key', async () => {
        mockSet.mockResolvedValue('OK');
        await cancelJob('job1');
        expect(mockSet).toHaveBeenCalledWith('job:job1:cancelled', '1', { ex: SECONDS_PER_HOUR });
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

    it('cleanupJob calls redis.del with all job keys', async () => {
        mockDel.mockResolvedValue(5);
        await cleanupJob('job1');
        expect(mockDel).toHaveBeenCalledWith(
            'job:job1:status',
            'job:job1:result',
            'job:job1:error',
            'job:job1:meta',
            'job:job1:cancelled'
        );
    });
});
