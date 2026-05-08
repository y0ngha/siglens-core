/**
 * User-facing message for the BYOK requirement gate.
 *
 * Shared across all analysis submission functions in the application layer
 * so the message can be updated in one place. UI consumers should treat the
 * accompanying `code: 'user_api_key_required'` as the machine-readable
 * discriminator.
 *
 * @internal
 */
export const USER_API_KEY_REQUIRED_MESSAGE =
    '선택한 모델은 BYOK API 키가 필요합니다. 키를 등록하거나 등급을 업그레이드해 주세요.';
