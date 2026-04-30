import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@upstash/redis', () => {
    const mockGet = vi.fn();
    const mockSet = vi.fn();
    const mockDel = vi.fn();
    const MockRedis = vi.fn(() => ({
        get: mockGet,
        set: mockSet,
        del: mockDel,
    }));
    return { Redis: MockRedis };
});

import { Redis } from '@upstash/redis';
import {
    buildEmailTokenKey,
    createEmailTokenStore,
} from '@/infrastructure/email/redis';
import type { EmailTokenValue } from '@/infrastructure/email/types';

const MockRedis = Redis as unknown as ReturnType<typeof vi.fn>;

describe('buildEmailTokenKey', () => {
    it('namespaces password reset and email verification keys separately', () => {
        const email = 'user@example.com';
        expect(buildEmailTokenKey('password_reset', email)).toBe(
            'email_token:password_reset:user@example.com'
        );
        expect(buildEmailTokenKey('email_verification', email)).toBe(
            'email_token:email_verification:user@example.com'
        );
    });
});

describe('createEmailTokenStore', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        MockRedis.mockClear();
    });

    it('returns null when UPSTASH_REDIS_REST_URL is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(createEmailTokenStore()).toBeNull();
    });

    it('returns null when UPSTASH_REDIS_REST_TOKEN is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(createEmailTokenStore()).toBeNull();
    });

    it('returns an EmailTokenStore when env vars are present (no readonly token)', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');
        const store = createEmailTokenStore();
        expect(store).not.toBeNull();
        expect(MockRedis).toHaveBeenCalledTimes(1);
    });

    it('creates a separate reader when readonly token is provided', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', 'readonly-token');
        const store = createEmailTokenStore();
        expect(store).not.toBeNull();
        expect(MockRedis).toHaveBeenCalledTimes(2);
    });

    describe('when env vars are present (no readonly token)', () => {
        beforeEach(() => {
            vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
            vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
            vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');
        });

        it('set delegates to writer.set with the namespaced key, value, and TTL', async () => {
            const mockSet = vi.fn().mockResolvedValue('OK');
            MockRedis.mockImplementation(() => ({
                get: vi.fn(),
                set: mockSet,
                del: vi.fn(),
            }));

            const store = createEmailTokenStore()!;
            const value: EmailTokenValue = {
                status: 'pending',
                tokenHash: 'hash',
            };
            await store.set(
                'email_verification',
                'user@example.com',
                value,
                1800
            );
            expect(mockSet).toHaveBeenCalledWith(
                'email_token:email_verification:user@example.com',
                value,
                { ex: 1800 }
            );
        });

        it('get delegates to reader.get with the namespaced key', async () => {
            const stored: EmailTokenValue = { status: 'verified' };
            const mockGet = vi.fn().mockResolvedValue(stored);
            MockRedis.mockImplementation(() => ({
                get: mockGet,
                set: vi.fn(),
                del: vi.fn(),
            }));

            const store = createEmailTokenStore()!;
            const result = await store.get(
                'email_verification',
                'user@example.com'
            );
            expect(mockGet).toHaveBeenCalledWith(
                'email_token:email_verification:user@example.com'
            );
            expect(result).toEqual(stored);
        });

        it('delete delegates to writer.del with the namespaced key', async () => {
            const mockDel = vi.fn().mockResolvedValue(1);
            MockRedis.mockImplementation(() => ({
                get: vi.fn(),
                set: vi.fn(),
                del: mockDel,
            }));

            const store = createEmailTokenStore()!;
            await store.delete('password_reset', 'user@example.com');
            expect(mockDel).toHaveBeenCalledWith(
                'email_token:password_reset:user@example.com'
            );
        });
    });

    it('reader uses readonly client when readonly token is set', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', 'readonly-token');

        const writerGet = vi.fn();
        const readerGet = vi.fn().mockResolvedValue(null);
        let callCount = 0;
        MockRedis.mockImplementation(() => {
            callCount++;
            return callCount === 1
                ? { get: writerGet, set: vi.fn(), del: vi.fn() }
                : { get: readerGet, set: vi.fn(), del: vi.fn() };
        });

        const store = createEmailTokenStore()!;
        await store.get('email_verification', 'user@example.com');
        expect(readerGet).toHaveBeenCalledWith(
            'email_token:email_verification:user@example.com'
        );
        expect(writerGet).not.toHaveBeenCalled();
    });
});
