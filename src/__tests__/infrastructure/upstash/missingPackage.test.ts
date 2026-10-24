import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterStoreUnavailableError } from '@/domain/ports/counterStore';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    CHAT_TOKEN_LIMIT,
    createChatTokenStore,
} from '@/infrastructure/chat/tokenStore';
import {
    getReanalyzeCooldownMs,
    tryAcquireReanalyzeCooldown,
} from '@/infrastructure/market/reanalyzeCooldown';
import { MissingSdkError } from '@/infrastructure/optionalPeer/loadOptionalSdk';
import { createCounterStore } from '@/infrastructure/usage/counterStore';

/**
 * Upstash env is set but `@upstash/redis` is not installed. Each adapter must
 * handle the missing package on the same path as a Redis outage
 * (docs/PUBLIC_API.md "Optional peer dependency"). That holds only while the
 * client is awaited inside the adapter's `try`; moving it out turns these
 * into unhandled `MissingSdkError`s.
 */
vi.mock('@/infrastructure/upstash/client', () => ({
    lazyRedisClient: () => () =>
        Promise.reject(
            new MissingSdkError('@upstash/redis', 'the Upstash Redis cache')
        ),
}));

beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('when @upstash/redis is not installed', () => {
    it('the cache provider rejects with MissingSdkError', async () => {
        await expect(createCacheProvider()!.get('k')).rejects.toBeInstanceOf(
            MissingSdkError
        );
    });

    it('the chat token store lets the request through', async () => {
        await expect(
            createChatTokenStore().tryConsumeToken('client')
        ).resolves.toBe(true);
    });

    it('the chat token store reports the full allowance', async () => {
        await expect(
            createChatTokenStore().getRemainingTokens('client')
        ).resolves.toBe(CHAT_TOKEN_LIMIT);
    });

    it("a 'closed' counter store throws CounterStoreUnavailableError", async () => {
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
        });
        await expect(store.consume('s', 1)).rejects.toBeInstanceOf(
            CounterStoreUnavailableError
        );
    });

    it("an 'open' counter store lets the request through", async () => {
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'open',
        });
        await expect(store.consume('s', 1)).resolves.toBe(true);
    });

    it('the reanalysis cooldown fails open', async () => {
        await expect(
            tryAcquireReanalyzeCooldown('AAPL', '1Day')
        ).resolves.toEqual({ ok: true });
    });

    it('the reanalysis cooldown reports no remaining time', async () => {
        await expect(getReanalyzeCooldownMs('AAPL', '1Day')).resolves.toBe(0);
    });
});
