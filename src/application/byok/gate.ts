import type { ModelId, Tier } from '@/domain/types';
import type { UserApiKeyRequiredError } from './types';
import { USER_API_KEY_REQUIRED_MESSAGE } from './messages';

/**
 * Build a BYOK gate denial result.
 *
 * Used by all analysis submit functions when a non-pro tier user
 * requests a premium model without registering a BYOK API key.
 *
 * @internal
 */
export function buildUserApiKeyRequiredError(
    tier: Tier,
    modelId: ModelId
): UserApiKeyRequiredError {
    return {
        status: 'key_error',
        code: 'user_api_key_required',
        error: USER_API_KEY_REQUIRED_MESSAGE,
        modelId,
        tier,
    };
}
