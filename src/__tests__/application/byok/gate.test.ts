import { describe, it, expect } from 'vitest';
import {
    buildUserApiKeyRequiredError,
    assertByokOnlyKeyPresent,
    isUserApiKeyGateDenied,
    isUserApiKeyGateDeniedAt,
    resolveInFlightKey,
} from '@/application/byok/gate';
import type { KeyPolicy } from '@/domain/keyRouting';
import { TIER_CONFIG } from '@/domain/tier';
import { UserApiKeyMissingError } from '@/application/byok/errors';
import { USER_API_KEY_REQUIRED_MESSAGE } from '@/application/byok/messages';

describe('buildUserApiKeyRequiredError', () => {
    it('returns correct UserApiKeyRequiredError shape', () => {
        const result = buildUserApiKeyRequiredError(
            'member',
            'gemini-3.1-pro-preview'
        );
        expect(result).toEqual({
            status: 'key_error',
            code: 'user_api_key_required',
            error: USER_API_KEY_REQUIRED_MESSAGE,
            modelId: 'gemini-3.1-pro-preview',
            tier: 'member',
        });
    });

    it('returns the same error message regardless of inputs', () => {
        const a = buildUserApiKeyRequiredError(
            'member',
            'gemini-3.1-pro-preview'
        );
        const b = buildUserApiKeyRequiredError('free', 'claude-opus-5');
        expect(a.error).toBe(b.error);
        expect(a.error).toBe(USER_API_KEY_REQUIRED_MESSAGE);
    });
});

describe('isUserApiKeyGateDeniedAt', () => {
    const at = (
        stage: 'before-cache' | 'after-cache',
        keyPolicy: KeyPolicy | undefined,
        userApiKey: string | undefined
    ) =>
        isUserApiKeyGateDeniedAt(
            stage,
            'free',
            'claude-opus-5',
            TIER_CONFIG,
            userApiKey,
            keyPolicy
        );

    it('default policy denies only before the cache read', () => {
        expect(at('before-cache', undefined, undefined)).toBe(true);
        expect(at('after-cache', undefined, undefined)).toBe(false);
        expect(at('before-cache', 'tier', undefined)).toBe(true);
        expect(at('after-cache', 'tier', undefined)).toBe(false);
    });

    it('byok-only denies only after the cache read', () => {
        expect(at('before-cache', 'byok-only', undefined)).toBe(false);
        expect(at('after-cache', 'byok-only', undefined)).toBe(true);
        expect(at('after-cache', 'byok-only', '')).toBe(true);
    });

    it('never denies when a key is present', () => {
        expect(at('before-cache', 'tier', 'sk-test')).toBe(false);
        expect(at('after-cache', 'byok-only', 'sk-test')).toBe(false);
    });
});

describe('isUserApiKeyGateDenied', () => {
    const deny = (
        model: Parameters<typeof isUserApiKeyGateDenied>[1],
        tier: Parameters<typeof isUserApiKeyGateDenied>[0],
        key: string | undefined,
        policy?: 'tier' | 'byok-only'
    ) => isUserApiKeyGateDenied(tier, model, TIER_CONFIG, key, policy);

    it('tier policy: only a byok-class model on a non-pro tier without a key is denied', () => {
        expect(deny('claude-opus-5', 'free', undefined)).toBe(true);
        expect(deny('claude-opus-5', 'free', 'k')).toBe(false);
        expect(deny('claude-opus-5', 'pro', undefined)).toBe(false);
        expect(deny('claude-sonnet-5-5', 'free', undefined)).toBe(false);
        expect(deny('gemini-3.6-flash', 'free', undefined, 'tier')).toBe(false);
    });

    it('byok-only: every model and tier is denied without a (non-empty) key', () => {
        for (const model of [
            'gemini-3.6-flash',
            'claude-sonnet-5-5',
            'claude-opus-5',
        ] as const) {
            for (const tier of ['free', 'member', 'pro'] as const) {
                expect(deny(model, tier, undefined, 'byok-only')).toBe(true);
                expect(deny(model, tier, '', 'byok-only')).toBe(true);
                expect(deny(model, tier, 'k', 'byok-only')).toBe(false);
            }
        }
    });
});

describe('unknown keyPolicy fails closed', () => {
    it('the gate treats an unknown string as byok-only', () => {
        const bogus = 'byok_only' as never;
        expect(
            isUserApiKeyGateDenied(
                'pro',
                'gemini-3.6-flash',
                TIER_CONFIG,
                undefined,
                bogus
            )
        ).toBe(true);
        expect(
            isUserApiKeyGateDenied(
                'pro',
                'gemini-3.6-flash',
                TIER_CONFIG,
                'k',
                bogus
            )
        ).toBe(false);
    });

    it('assertByokOnlyKeyPresent throws for byok-only and unknown values, never for tier/undefined', () => {
        for (const policy of ['byok-only', 'typo'] as KeyPolicy[]) {
            expect(() => assertByokOnlyKeyPresent(policy, undefined)).toThrow(
                UserApiKeyMissingError
            );
            expect(() => assertByokOnlyKeyPresent(policy, '')).toThrow(
                UserApiKeyMissingError
            );
            expect(() => assertByokOnlyKeyPresent(policy, 'k')).not.toThrow();
        }
        for (const policy of ['tier', undefined] as const) {
            expect(() =>
                assertByokOnlyKeyPresent(policy, undefined)
            ).not.toThrow();
        }
    });
});

describe('resolveInFlightKey', () => {
    const CACHE_KEY = 'analysis:AAPL:1Day';

    it('keeps the cache key for the tier policy, so website callers still share a run', () => {
        expect(resolveInFlightKey(CACHE_KEY, undefined, 'k')).toBe(CACHE_KEY);
        expect(resolveInFlightKey(CACHE_KEY, 'tier', 'k')).toBe(CACHE_KEY);
    });

    it('scopes byok-only by a hash of the key and never contains the raw key', () => {
        const a = resolveInFlightKey(CACHE_KEY, 'byok-only', 'sk-secret-one');
        const b = resolveInFlightKey(CACHE_KEY, 'byok-only', 'sk-secret-two');
        expect(a).not.toBe(CACHE_KEY);
        expect(a).not.toBe(b);
        expect(a).toBe(
            resolveInFlightKey(CACHE_KEY, 'byok-only', 'sk-secret-one')
        );
        expect(a).toMatch(new RegExp(`^${CACHE_KEY}:byok:[0-9a-f]{16}$`));
        expect(a).not.toContain('sk-secret');
    });

    it('scopes an unknown policy value like byok-only', () => {
        expect(resolveInFlightKey(CACHE_KEY, 'oops' as never, 'k')).toBe(
            resolveInFlightKey(CACHE_KEY, 'byok-only', 'k')
        );
    });
});
