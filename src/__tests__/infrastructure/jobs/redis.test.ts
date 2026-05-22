import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@upstash/redis', () => {
    const MockRedis = vi.fn();
    return { Redis: MockRedis };
});

import { Redis } from '@upstash/redis';
import { createJobStateStore } from '@/infrastructure/jobs/redis';

// vi.mock이 Redis 생성자를 vi.fn()으로 교체하지만 TypeScript가 이를 감지하지 못해
// mock API(mockImplementation, mockClear 등) 접근을 위해 캐스트
const MockRedis = Redis as unknown as ReturnType<typeof vi.fn>;

describe('createJobStateStore', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        MockRedis.mockClear();
    });

    it('returns null when UPSTASH_REDIS_REST_URL is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(createJobStateStore()).toBeNull();
    });

    it('returns null when UPSTASH_REDIS_REST_TOKEN is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createJobStateStore()).toBeNull();
    });

    it('returns null when both env vars are missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createJobStateStore()).toBeNull();
    });

    it('returns a JobStateStore adapter when env vars are present', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        MockRedis.mockImplementation(() => ({
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
        }));
        const result = createJobStateStore();
        expect(result).not.toBeNull();
        expect(MockRedis).toHaveBeenCalledWith({
            url: 'https://example.upstash.io',
            token: 'token',
        });
    });

    it('adapter translates ttlSeconds to Upstash { ex } option on set', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        const mockSet = vi.fn().mockResolvedValue('OK');
        MockRedis.mockImplementation(() => ({
            get: vi.fn(),
            set: mockSet,
            del: vi.fn(),
        }));
        const store = createJobStateStore();
        if (store === null) throw new Error('store should not be null');
        await store.set('k', 'v', { ttlSeconds: 60 });
        expect(mockSet).toHaveBeenCalledWith('k', 'v', { ex: 60 });
    });

    it('adapter forwards get to the underlying Redis client', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        const mockGet = vi.fn().mockResolvedValue('value');
        MockRedis.mockImplementation(() => ({
            get: mockGet,
            set: vi.fn(),
            del: vi.fn(),
        }));
        const store = createJobStateStore();
        if (store === null) throw new Error('store should not be null');
        const value = await store.get<string>('k');
        expect(mockGet).toHaveBeenCalledWith('k');
        expect(value).toBe('value');
    });

    it('adapter translates deleteMany to Upstash del with spread keys', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        const mockDel = vi.fn().mockResolvedValue(3);
        MockRedis.mockImplementation(() => ({
            get: vi.fn(),
            set: vi.fn(),
            del: mockDel,
        }));
        const store = createJobStateStore();
        if (store === null) throw new Error('store should not be null');
        const removed = await store.deleteMany('a', 'b', 'c');
        expect(mockDel).toHaveBeenCalledWith('a', 'b', 'c');
        expect(removed).toBe(3);
    });
});
