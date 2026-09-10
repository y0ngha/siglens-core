import { describe, it, expect } from 'vitest';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
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
