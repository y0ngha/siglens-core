import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@upstash/redis', () => {
    const mockGet = vi.fn();
    const mockSet = vi.fn();
    const mockDel = vi.fn();
    const MockRedis = vi.fn(() => ({ get: mockGet, set: mockSet, del: mockDel }));
    return { Redis: MockRedis };
});

import { Redis } from '@upstash/redis';
import { createCacheProvider } from '@/infrastructure/cache/redis';

const MockRedis = Redis as unknown as ReturnType<typeof vi.fn>;

describe('createCacheProvider', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        MockRedis.mockClear();
    });

    it('returns null when UPSTASH_REDIS_REST_URL is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(createCacheProvider()).toBeNull();
    });

    it('returns null when UPSTASH_REDIS_REST_TOKEN is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createCacheProvider()).toBeNull();
    });

    it('returns null when both env vars are missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createCacheProvider()).toBeNull();
    });

    it('returns CacheProvider when required env vars are present (no readonly token)', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');
        const provider = createCacheProvider();
        expect(provider).not.toBeNull();
        // only one Redis instance (writer = reader)
        expect(MockRedis).toHaveBeenCalledTimes(1);
    });

    it('creates separate reader when readonly token is provided', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', 'readonly-token');
        const provider = createCacheProvider();
        expect(provider).not.toBeNull();
        // two Redis instances: writer + reader
        expect(MockRedis).toHaveBeenCalledTimes(2);
    });

    it('get delegates to reader.get', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');

        const mockGet = vi.fn().mockResolvedValue({ foo: 'bar' });
        MockRedis.mockImplementation(() => ({
            get: mockGet,
            set: vi.fn(),
            del: vi.fn(),
        }));

        const provider = createCacheProvider()!;
        const result = await provider.get<{ foo: string }>('my-key');
        expect(mockGet).toHaveBeenCalledWith('my-key');
        expect(result).toEqual({ foo: 'bar' });
    });

    it('set delegates to writer.set with ex option', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');

        const mockSet = vi.fn().mockResolvedValue('OK');
        MockRedis.mockImplementation(() => ({
            get: vi.fn(),
            set: mockSet,
            del: vi.fn(),
        }));

        const provider = createCacheProvider()!;
        await provider.set('my-key', { data: 1 }, 300);
        expect(mockSet).toHaveBeenCalledWith('my-key', { data: 1 }, { ex: 300 });
    });

    it('delete delegates to writer.del', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');

        const mockDel = vi.fn().mockResolvedValue(1);
        MockRedis.mockImplementation(() => ({
            get: vi.fn(),
            set: vi.fn(),
            del: mockDel,
        }));

        const provider = createCacheProvider()!;
        await provider.delete('my-key');
        expect(mockDel).toHaveBeenCalledWith('my-key');
    });

    it('reader uses readonly client when readonly token is set', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', 'readonly-token');

        const writerGet = vi.fn();
        const readerGet = vi.fn().mockResolvedValue('cached');
        let callCount = 0;
        MockRedis.mockImplementation(() => {
            callCount++;
            return callCount === 1
                ? { get: writerGet, set: vi.fn(), del: vi.fn() }
                : { get: readerGet, set: vi.fn(), del: vi.fn() };
        });

        const provider = createCacheProvider()!;
        await provider.get('some-key');
        expect(readerGet).toHaveBeenCalledWith('some-key');
        expect(writerGet).not.toHaveBeenCalled();
    });
});
