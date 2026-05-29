import type { ModelId, Tier } from '@/domain/types';

/**
 * BYOK gate denial result.
 *
 * Returned when a non-pro tier user requests a premium model without
 * registering a BYOK API key. Shared across all analysis submission
 * functions in the application layer — each function-specific result
 * union aliases this type.
 */
export interface UserApiKeyRequiredError {
    /** Discriminant: 'key_error' identifies BYOK-required outcomes. */
    status: 'key_error';
    /** Machine-readable code for narrowing within the 'key_error' status. */
    code: 'user_api_key_required';
    /** User-facing message explaining the BYOK requirement. */
    error: string;
    /** The model that triggered the BYOK requirement. */
    modelId: ModelId;
    /** The tier that triggered the BYOK requirement. */
    tier: Tier;
}
