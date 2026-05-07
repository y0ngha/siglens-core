import type { BackgroundTaskOptions } from '@/application/types';
import {
    cleanupJob,
    clearInFlightJob,
    getJobMeta,
} from '@/infrastructure/jobs/queue';

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

/**
 * Read the job's meta first so the in-flight slot keyed by `cacheKey` can be
 * released alongside the rest of the job keys (status / result / error /
 * meta / cancelled / refcount). Without this release, a stale
 * `inflight:{cacheKey}` would force later submitters to attach to a job
 * that has already produced its result.
 */
async function executeCleanup(
    jobId: string,
    logPrefix: string
): Promise<void> {
    const meta = await getJobMeta(jobId).catch(error => {
        console.warn(`${logPrefix} cleanup meta read failed:`, error);
        return null;
    });
    await clearInFlightJob(jobId, meta?.cacheKey).catch(error =>
        console.warn(`${logPrefix} clearInFlightJob failed:`, error)
    );
    await cleanupJob(jobId).catch(error =>
        console.warn(`${logPrefix} cleanupJob failed:`, error)
    );
}

/**
 * Clean up a terminal job's Redis state without making cleanup failures
 * affect the caller.
 */
export function cleanupInBackground(
    jobId: string,
    logPrefix: string,
    options?: BackgroundTaskOptions
): void {
    fireAndForget(executeCleanup(jobId, logPrefix), options);
}
