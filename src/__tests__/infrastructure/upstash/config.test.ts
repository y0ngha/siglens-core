import { describe, it, expect, vi, afterEach } from 'vitest';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

describe('readUpstashConfig', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns null when URL is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(readUpstashConfig()).toBeNull();
    });

    it('returns null when token is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(readUpstashConfig()).toBeNull();
    });

    it('returns config when both URL and token are present', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', 'readonly-token');
        expect(readUpstashConfig()).toEqual({
            url: 'https://example.upstash.io',
            token: 'master-token',
            readonlyToken: 'readonly-token',
        });
    });

    it('returns empty readonlyToken when env var is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');
        expect(readUpstashConfig()?.readonlyToken).toBe('');
    });
});
