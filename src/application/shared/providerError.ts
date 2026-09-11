import { constants } from 'node:http2';

export type ProviderErrorCode = 'rate_limited' | 'server_busy' | 'server_error';

function getHttpErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
        return undefined;
    }
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
}

/** Map an upstream SDK error to the UI-facing code shared by chat and agent. */
export function classifyProviderError(error: unknown): ProviderErrorCode {
    const status = getHttpErrorStatus(error);
    if (status === constants.HTTP_STATUS_TOO_MANY_REQUESTS)
        return 'rate_limited';
    if (status === constants.HTTP_STATUS_SERVICE_UNAVAILABLE)
        return 'server_busy';
    return 'server_error';
}
