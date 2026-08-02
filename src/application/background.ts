import type { BackgroundTaskOptions } from '@/application/types';

/**
 * Register a background promise with the runtime when a waitUntil hook exists.
 *
 * The promise should already handle its own errors before being passed here.
 */
export function fireAndForget(
    promise: Promise<unknown>,
    options?: BackgroundTaskOptions
): void {
    options?.waitUntil?.(promise);
}
