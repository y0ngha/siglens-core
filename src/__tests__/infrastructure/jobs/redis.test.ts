import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@upstash/redis', () => {
    const MockRedis = vi.fn();
    return { Redis: MockRedis };
});

import { Redis } from '@upstash/redis';
import { createJobRedis } from '@/infrastructure/jobs/redis';

// vi.mock이 Redis 생성자를 vi.fn()으로 교체하지만 TypeScript가 이를 감지하지 못해
// mock API(mockImplementation, mockClear 등) 접근을 위해 캐스트
const MockRedis = Redis as unknown as ReturnType<typeof vi.fn>;

describe('createJobRedis', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        MockRedis.mockClear();
    });

    it('returns null when UPSTASH_REDIS_REST_URL is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(createJobRedis()).toBeNull();
    });

    it('returns null when UPSTASH_REDIS_REST_TOKEN is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createJobRedis()).toBeNull();
    });

    it('returns null when both env vars are missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createJobRedis()).toBeNull();
    });

    it('returns wrapper that delegates each method to the underlying Redis client', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        const get = vi.fn().mockResolvedValue('got');
        const set = vi.fn().mockResolvedValue('OK');
        const del = vi.fn().mockResolvedValue(1);
        const incr = vi.fn().mockResolvedValue(2);
        const decr = vi.fn().mockResolvedValue(0);
        const expire = vi.fn().mockResolvedValue(1);
        MockRedis.mockImplementation(() => ({
            get,
            set,
            del,
            incr,
            decr,
            expire,
        }));

        const wrapper = createJobRedis();
        if (wrapper === null) throw new Error('expected non-null wrapper');
        expect(MockRedis).toHaveBeenCalledWith({
            url: 'https://example.upstash.io',
            token: 'token',
        });

        // Each wrapper method must forward arguments and return value to the
        // underlying Upstash client. setNx attaches { nx: true } on the
        // underlying set call so the SET ... NX EX command shape is used.
        await expect(wrapper.get<string>('a')).resolves.toBe('got');
        expect(get).toHaveBeenCalledWith('a');

        await expect(
            wrapper.set('a', { v: 1 }, { ex: 60 })
        ).resolves.toBe('OK');
        expect(set).toHaveBeenLastCalledWith('a', { v: 1 }, { ex: 60 });

        await expect(
            wrapper.setNx('a', 'job', { ex: 60 })
        ).resolves.toBe('OK');
        expect(set).toHaveBeenLastCalledWith('a', 'job', {
            ex: 60,
            nx: true,
        });

        await expect(wrapper.del('a', 'b')).resolves.toBe(1);
        expect(del).toHaveBeenCalledWith('a', 'b');

        await expect(wrapper.incr('rc')).resolves.toBe(2);
        expect(incr).toHaveBeenCalledWith('rc');

        await expect(wrapper.decr('rc')).resolves.toBe(0);
        expect(decr).toHaveBeenCalledWith('rc');

        await expect(wrapper.expire('rc', 60)).resolves.toBe(1);
        expect(expire).toHaveBeenCalledWith('rc', 60);
    });
});
