/**
 * Thrown by `callAnalysisAi` when no user API key is available for a call that
 * must use one — before any provider is contacted.
 *
 * Two cases reach it: a `'byok'`-class model on a non-pro tier without a
 * `userApiKey` (`keyPolicy: 'tier'`), and any call under
 * `keyPolicy: 'byok-only'` without a non-empty `userApiKey`. Use-cases that
 * already return a `key_error` result gate earlier and never throw this;
 * the throw is the contract for the ones that return no such variant.
 *
 * `message` is the exact string the plain `Error` used to carry, so existing
 * message matching keeps working.
 */
export class UserApiKeyMissingError extends Error {
    readonly code = 'user_api_key_required' as const;

    constructor() {
        super('User API key required for this model and tier combination');
        this.name = 'UserApiKeyMissingError';
    }
}
