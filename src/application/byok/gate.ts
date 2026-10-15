import { UserApiKeyMissingError } from '@/application/byok/errors';
import { hashApiKeyScope } from '@/infrastructure/hash/analysisInput';
import { isByokOnly, type KeyPolicy } from '@/domain/keyRouting';
import { requiresByokKey } from '@/domain/tier';
import type { ModelId, Tier, TierConfig } from '@/domain/types';
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

/**
 * Whether a run must be denied with a BYOK-required result because it has no
 * usable user key.
 *
 * - `keyPolicy: 'tier'` (default): the pre-existing gate — a `'byok'`-class
 *   model on a non-pro tier with `userApiKey === undefined`. Unchanged.
 * - `keyPolicy: 'byok-only'`: every model needs the caller's key, so the gate
 *   denies whenever `userApiKey` is missing or empty. `tier` plays no part.
 *
 * Use-cases call this where they used to inline `requiresByokKey(...) &&
 * userApiKey === undefined`, so the gate and `callAnalysisAi`'s routing agree.
 *
 * @internal
 */
export function isUserApiKeyGateDenied(
    tier: Tier,
    modelId: ModelId,
    tierConfig: TierConfig,
    userApiKey: string | undefined,
    keyPolicy: KeyPolicy | undefined
): boolean {
    if (isByokOnly(keyPolicy)) {
        return userApiKey === undefined || userApiKey === '';
    }
    return (
        requiresByokKey(tier, modelId, tierConfig) && userApiKey === undefined
    );
}

/**
 * Throw `UserApiKeyMissingError` when `keyPolicy` is byok-only and the key is
 * missing or empty. For the use-cases with no `key_error` result variant; call
 * it AFTER the cache read (a cached result is served keyless — cache hits are
 * free) and BEFORE any data fetch or Redis lock.
 *
 * @internal
 */
export function assertByokOnlyKeyPresent(
    keyPolicy: KeyPolicy | undefined,
    userApiKey: string | undefined
): void {
    if (
        isByokOnly(keyPolicy) &&
        (userApiKey === undefined || userApiKey === '')
    ) {
        throw new UserApiKeyMissingError();
    }
}

/**
 * Key for the in-process in-flight join (`dedupeGeneration`'s `inFlightKey`).
 *
 * `'tier'` runs keep `cacheKey`, so website callers still share one dispatch.
 * A byok-only run is scoped by policy and by a hash of its own key, so it
 * never joins a run on another key or policy (and never leaks its failure or
 * abort signal to one). The raw key is never part of the result.
 *
 * @internal
 */
export function resolveInFlightKey(
    cacheKey: string,
    keyPolicy: KeyPolicy | undefined,
    userApiKey: string | undefined
): string {
    if (!isByokOnly(keyPolicy)) return cacheKey;
    return `${cacheKey}:byok:${hashApiKeyScope(userApiKey ?? '')}`;
}
