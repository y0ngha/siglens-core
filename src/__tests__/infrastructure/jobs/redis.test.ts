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

    it('returns Redis instance when env vars are present', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        MockRedis.mockImplementation(() => ({}));
        const result = createJobRedis();
        expect(result).not.toBeNull();
        expect(MockRedis).toHaveBeenCalledWith({
            url: 'https://example.upstash.io',
            token: 'token',
        });
    });
});
