import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { mockIncr, mockExpire, mockGet, mockDecr, mockRedisConstructor } =
    vi.hoisted(() => {
        const incr = vi.fn();
        const expire = vi.fn();
        const get = vi.fn();
        const decr = vi.fn();
        const constructor = vi.fn(function () {
            return {
                incr,
                expire,
                get,
                decr,
            };
        });

        return {
            mockIncr: incr,
            mockExpire: expire,
            mockGet: get,
            mockDecr: decr,
            mockRedisConstructor: constructor,
        };
    });

vi.mock('@upstash/redis', () => ({
    Redis: mockRedisConstructor,
}));

import {
    CHAT_TOKEN_LIMIT,
    CHAT_TOKEN_TTL_SEC,
    createChatTokenStore,
    hashClientIp,
} from '@/infrastructure/chat/tokenStore';

describe('hashClientIp', () => {
    it('returns a stable SHA-256 hex hash', () => {
        const first = hashClientIp('1.2.3.4');
        const second = hashClientIp('1.2.3.4');

        expect(first).toBe(second);
        expect(first).toHaveLength(64);
        expect(first).toMatch(/^[0-9a-f]+$/);
    });

    it('returns different hashes for different IP values', () => {
        expect(hashClientIp('1.2.3.4')).not.toBe(hashClientIp('5.6.7.8'));
    });
});

describe('createChatTokenStore', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = {
            ...originalEnv,
            UPSTASH_REDIS_REST_URL: 'https://redis.test',
            UPSTASH_REDIS_REST_TOKEN: 'token',
        };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('consumes a token and applies the chat token TTL', async () => {
        mockIncr.mockResolvedValueOnce(CHAT_TOKEN_LIMIT);
        mockExpire.mockResolvedValueOnce(1);

        const store = createChatTokenStore();
        const result = await store.tryConsumeToken('hashed-id');

        expect(result).toBe(true);
        expect(mockIncr).toHaveBeenCalledWith('chat:tokens:hashed-id');
        expect(mockExpire).toHaveBeenCalledWith(
            'chat:tokens:hashed-id',
            CHAT_TOKEN_TTL_SEC,
            'NX'
        );
    });

    it('rejects token consumption after the limit is exceeded', async () => {
        mockIncr.mockResolvedValueOnce(CHAT_TOKEN_LIMIT + 1);
        mockExpire.mockResolvedValueOnce(0);

        const store = createChatTokenStore();
        const result = await store.tryConsumeToken('hashed-id');

        expect(result).toBe(false);
        expect(mockExpire).toHaveBeenCalledWith(
            'chat:tokens:hashed-id',
            CHAT_TOKEN_TTL_SEC,
            'NX'
        );
    });

    it('allows token consumption when Redis config is missing', async () => {
        delete process.env.UPSTASH_REDIS_REST_URL;

        const store = createChatTokenStore();
        const result = await store.tryConsumeToken('hashed-id');

        expect(result).toBe(true);
        expect(mockRedisConstructor).not.toHaveBeenCalled();
        expect(mockIncr).not.toHaveBeenCalled();
    });

    it('allows token consumption when Redis fails', async () => {
        mockIncr.mockRejectedValueOnce(new Error('redis failed'));

        const store = createChatTokenStore();
        const result = await store.tryConsumeToken('hashed-id');

        expect(result).toBe(true);
    });

    it('refunds one consumed token when a count exists', async () => {
        mockGet.mockResolvedValueOnce(2);
        mockDecr.mockResolvedValueOnce(1);

        const store = createChatTokenStore();
        await store.refundConsumedToken('hashed-id');

        expect(mockGet).toHaveBeenCalledWith('chat:tokens:hashed-id');
        expect(mockDecr).toHaveBeenCalledWith('chat:tokens:hashed-id');
    });

    it('does not refund when the token key is absent', async () => {
        mockGet.mockResolvedValueOnce(null);

        const store = createChatTokenStore();
        await store.refundConsumedToken('hashed-id');

        expect(mockDecr).not.toHaveBeenCalled();
    });

    it('does not refund when the token count is already zero', async () => {
        mockGet.mockResolvedValueOnce(0);

        const store = createChatTokenStore();
        await store.refundConsumedToken('hashed-id');

        expect(mockDecr).not.toHaveBeenCalled();
    });

    it('skips token refund when Redis config is missing', async () => {
        delete process.env.UPSTASH_REDIS_REST_URL;

        const store = createChatTokenStore();
        await store.refundConsumedToken('hashed-id');

        expect(mockRedisConstructor).not.toHaveBeenCalled();
        expect(mockDecr).not.toHaveBeenCalled();
    });

    it('swallows Redis refund failures', async () => {
        mockGet.mockRejectedValueOnce(new Error('redis failed'));

        const store = createChatTokenStore();
        await expect(
            store.refundConsumedToken('hashed-id')
        ).resolves.toBeUndefined();
    });

    it('returns the token limit when no token key exists', async () => {
        mockGet.mockResolvedValueOnce(null);

        const store = createChatTokenStore();
        const result = await store.getRemainingTokens('hashed-id');

        expect(result).toBe(CHAT_TOKEN_LIMIT);
        expect(mockGet).toHaveBeenCalledWith('chat:tokens:hashed-id');
    });

    it('returns remaining tokens from the stored count', async () => {
        mockGet.mockResolvedValueOnce(2);

        const store = createChatTokenStore();
        const result = await store.getRemainingTokens('hashed-id');

        expect(result).toBe(CHAT_TOKEN_LIMIT - 2);
    });

    it('clamps remaining tokens at zero', async () => {
        mockGet.mockResolvedValueOnce(CHAT_TOKEN_LIMIT + 2);

        const store = createChatTokenStore();
        const result = await store.getRemainingTokens('hashed-id');

        expect(result).toBe(0);
    });

    it('returns the token limit when Redis config is missing', async () => {
        delete process.env.UPSTASH_REDIS_REST_TOKEN;

        const store = createChatTokenStore();
        const result = await store.getRemainingTokens('hashed-id');

        expect(result).toBe(CHAT_TOKEN_LIMIT);
        expect(mockRedisConstructor).not.toHaveBeenCalled();
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('returns the token limit when Redis read fails', async () => {
        mockGet.mockRejectedValueOnce(new Error('redis failed'));

        const store = createChatTokenStore();
        const result = await store.getRemainingTokens('hashed-id');

        expect(result).toBe(CHAT_TOKEN_LIMIT);
    });
});
