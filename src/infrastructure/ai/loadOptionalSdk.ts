/** @internal Error code carried by {@link MissingSdkError}. */
export const MISSING_SDK_CODE = 'AI_SDK_NOT_INSTALLED';

/**
 * @internal
 * Thrown on first use of a provider whose optional peer SDK is not installed.
 *
 * Carries neither `status` nor `retryable`, so `classifyError` returns `'none'`
 * and the retry wrappers rethrow it immediately instead of looping — installing
 * a package is not a transient condition.
 */
export class MissingSdkError extends Error {
    readonly code = MISSING_SDK_CODE;
    readonly sdk: string;

    constructor(sdk: string, purpose: string, options?: ErrorOptions) {
        super(
            `@y0ngha/siglens-core: '${sdk}' is required for ${purpose} — install it as a dependency`,
            options
        );
        this.name = 'MissingSdkError';
        this.sdk = sdk;
    }
}

const MODULE_NOT_FOUND_CODES: ReadonlySet<string> = new Set([
    'MODULE_NOT_FOUND',
    'ERR_MODULE_NOT_FOUND',
]);

/**
 * True only when the *requested SDK itself* is absent. A missing transitive
 * dependency (or a missing file inside an installed SDK) is a broken install
 * and must surface unchanged, so the message is checked for the package name.
 */
function isMissingModuleError(error: unknown, sdk: string): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    return (
        typeof code === 'string' &&
        MODULE_NOT_FOUND_CODES.has(code) &&
        typeof message === 'string' &&
        message.includes(`'${sdk}'`)
    );
}

/**
 * @internal
 * Memoized lazy loader for an optional peer SDK.
 *
 * The SDKs (`@anthropic-ai/sdk`, `@google/genai`, `openai`) are optional peer
 * dependencies, so they must not be `require`d when the package entry is
 * loaded. `importer` must contain the literal `import('<sdk>')` so the bundler
 * and tsc see a static specifier; this helper only adds memoization and the
 * install-hint error.
 *
 * A failed load is not memoized, so installing the SDK at runtime (or a retry
 * after a transient fs error) can succeed later.
 *
 * @param sdk - Package name, used for the error message and missing-module match.
 * @param purpose - Human-readable use, e.g. `'Claude models'`.
 * @param importer - `() => import('<sdk>')`.
 * @returns A function resolving to the SDK module namespace.
 */
export function loadOptionalSdk<M>(
    sdk: string,
    purpose: string,
    importer: () => Promise<M>
): () => Promise<M> {
    let cached: Promise<M> | undefined;
    return () => {
        if (cached === undefined) {
            const attempt = importer().catch((error: unknown) => {
                cached = undefined;
                if (isMissingModuleError(error, sdk)) {
                    throw new MissingSdkError(sdk, purpose, { cause: error });
                }
                throw error;
            });
            cached = attempt;
        }
        return cached;
    };
}
