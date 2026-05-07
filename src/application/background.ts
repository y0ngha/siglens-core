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
async function executeCleanup(jobId: string, logPrefix: string): Promise<void> {
    const meta = await getJobMeta(jobId).catch(error => {
        console.warn(`${logPrefix} cleanup meta read failed:`, error);
        return null;
    });
    // refcount 키는 clearInFlightJob과 cleanupJob 양쪽에서 DEL을 시도한다.
    // Redis DEL은 멱등이므로 동작상 이중 삭제는 무해하지만, 두 함수의 책임을
    // 분리해서 유지한다 — clearInFlightJob은 dedup 슬롯 + refcount만, cleanupJob은
    // 잡 라이프사이클 키 일괄 삭제. 여기서는 두 함수를 직렬로 묶어 양쪽 모두를
    // 안전하게 마무리한다.
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
