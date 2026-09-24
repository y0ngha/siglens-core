import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@upstash/redis');

import { Redis } from '@upstash/redis';
import type { Mock } from 'vitest';
import {
    tryAcquireReanalyzeCooldown,
    releaseReanalyzeCooldown,
    getReanalyzeCooldownMs,
} from '@/infrastructure/market/reanalyzeCooldown';

const MockRedis = Redis as unknown as Mock;
const mockSet = vi.fn();
const mockPttl = vi.fn();
const mockDel = vi.fn();

describe('reanalyzeCooldown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        MockRedis.mockImplementation(function () {
            return {
                set: mockSet,
                pttl: mockPttl,
                del: mockDel,
            };
        });
        process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
        process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    });

    afterEach(() => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
    });

    describe('tryAcquireReanalyzeCooldown', () => {
        it('Redis 없으면 ok: true를 반환한다', async () => {
            delete process.env.UPSTASH_REDIS_REST_URL;

            const result = await tryAcquireReanalyzeCooldown('AAPL', '1Day');

            expect(result.ok).toBe(true);
        });

        it('set이 OK이면 ok: true를 반환한다', async () => {
            mockSet.mockResolvedValueOnce('OK');

            const result = await tryAcquireReanalyzeCooldown('AAPL', '1Day');

            expect(result.ok).toBe(true);
        });

        it('set이 null이면 pttl을 조회하고 ok: false를 반환한다', async () => {
            mockSet.mockResolvedValueOnce(null);
            mockPttl.mockResolvedValueOnce(120000);

            const result = await tryAcquireReanalyzeCooldown('AAPL', '1Day');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.remainingMs).toBe(120000);
            }
        });

        it('pttl이 0 이하이면 기본 쿨다운을 반환한다', async () => {
            mockSet.mockResolvedValueOnce(null);
            mockPttl.mockResolvedValueOnce(0);

            const result = await tryAcquireReanalyzeCooldown('AAPL', '1Day');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.remainingMs).toBeGreaterThan(0);
            }
        });

        it('Redis 에러 시 ok: true를 반환한다 (fail-open)', async () => {
            mockSet.mockRejectedValueOnce(new Error('Redis error'));
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const result = await tryAcquireReanalyzeCooldown('AAPL', '1Day');

            expect(result.ok).toBe(true);
            consoleSpy.mockRestore();
        });
    });

    describe('releaseReanalyzeCooldown', () => {
        it('Redis 없으면 아무것도 하지 않는다', async () => {
            delete process.env.UPSTASH_REDIS_REST_URL;

            await releaseReanalyzeCooldown('AAPL', '1Day');

            expect(mockDel).not.toHaveBeenCalled();
        });

        it('키를 삭제한다', async () => {
            mockDel.mockResolvedValueOnce(1);

            await releaseReanalyzeCooldown('AAPL', '1Day');

            expect(mockDel).toHaveBeenCalledWith('analysis:cooldown:AAPL:1Day');
        });

        it('Redis 에러 시 에러를 전파하지 않는다', async () => {
            mockDel.mockRejectedValueOnce(new Error('Redis error'));
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            await expect(
                releaseReanalyzeCooldown('AAPL', '1Day')
            ).resolves.toBeUndefined();

            consoleSpy.mockRestore();
        });
    });

    describe('getReanalyzeCooldownMs', () => {
        it('Redis 없으면 0을 반환한다', async () => {
            delete process.env.UPSTASH_REDIS_REST_URL;

            const result = await getReanalyzeCooldownMs('AAPL', '1Day');

            expect(result).toBe(0);
        });

        it('pttl이 양수이면 해당 값을 반환한다', async () => {
            mockPttl.mockResolvedValueOnce(90000);

            const result = await getReanalyzeCooldownMs('AAPL', '1Day');

            expect(result).toBe(90000);
        });

        it('pttl이 0 이하이면 0을 반환한다', async () => {
            mockPttl.mockResolvedValueOnce(-1);

            const result = await getReanalyzeCooldownMs('AAPL', '1Day');

            expect(result).toBe(0);
        });

        it('Redis 에러 시 0을 반환한다', async () => {
            mockPttl.mockRejectedValueOnce(new Error('Redis error'));
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const result = await getReanalyzeCooldownMs('AAPL', '1Day');

            expect(result).toBe(0);
            consoleSpy.mockRestore();
        });
    });
});
