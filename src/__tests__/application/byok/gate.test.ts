import { describe, it, expect } from 'vitest';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import { USER_API_KEY_REQUIRED_MESSAGE } from '@/application/byok/messages';

describe('buildUserApiKeyRequiredError', () => {
    it('returns correct UserApiKeyRequiredError shape', () => {
        const result = buildUserApiKeyRequiredError('member', 'gemini-2.5-pro');
        expect(result).toEqual({
            status: 'key_error',
            code: 'user_api_key_required',
            error: USER_API_KEY_REQUIRED_MESSAGE,
            modelId: 'gemini-2.5-pro',
            tier: 'member',
        });
    });

    it('preserves the modelId argument', () => {
        const result = buildUserApiKeyRequiredError('free', 'claude-opus-4-7');
        expect(result.modelId).toBe('claude-opus-4-7');
    });

    it('preserves the tier argument', () => {
        const result = buildUserApiKeyRequiredError('free', 'gemini-2.5-pro');
        expect(result.tier).toBe('free');
    });
});
