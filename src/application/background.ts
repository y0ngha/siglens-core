import type { BackgroundTaskOptions } from '@/application/types';
import { cleanupJob } from '@/infrastructure/jobs/queue';

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

/** Clean up a queued job without making cleanup failures affect the caller. */
export function cleanupInBackground(
    jobId: string,
    logPrefix: string,
    options?: BackgroundTaskOptions
): void {
    fireAndForget(
        cleanupJob(jobId).catch(error =>
            console.warn(`${logPrefix} cleanupJob failed:`, error)
        ),
        options
    );
}
