import { describe, expect, it } from 'vitest';
import { classifyProviderError } from '@/application/shared/providerError';

describe('classifyProviderError', () => {
    it('429 → rate_limited, 503 → server_busy, 그 외 → server_error', () => {
        expect(classifyProviderError({ status: 429 })).toBe('rate_limited');
        expect(classifyProviderError({ status: 503 })).toBe('server_busy');
        expect(classifyProviderError({ status: 500 })).toBe('server_error');
        expect(classifyProviderError(new Error('boom'))).toBe('server_error');
        expect(classifyProviderError(null)).toBe('server_error');
    });
});
