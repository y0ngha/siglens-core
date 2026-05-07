import { createJobRedis } from '@/infrastructure/jobs/redis';
import type {
    JobMeta,
    JobRedisClient,
    JobStatus,
    RedisSetOpts,
} from '@/infrastructure/jobs/types';
import { SECONDS_PER_HOUR } from '@/domain/constants/time';

const JOB_TTL_SECONDS = SECONDS_PER_HOUR;
const JOB_TTL_OPTS: RedisSetOpts = { ex: JOB_TTL_SECONDS };

function statusKey(jobId: string): string {
    return `job:${jobId}:status`;
}

function resultKey(jobId: string): string {
    return `job:${jobId}:result`;
}

function errorKey(jobId: string): string {
    return `job:${jobId}:error`;
}

function metaKey(jobId: string): string {
    return `job:${jobId}:meta`;
}

function cancelledKey(jobId: string): string {
    return `job:${jobId}:cancelled`;
}

/**
 * Indexed by `cacheKey` so concurrent submitters that hash to the same input
 * coalesce onto a single in-flight job. The stored value is the canonical
 * `jobId` shared by all subscribers.
 */
function inFlightKey(cacheKey: string): string {
    return `job:inflight:${cacheKey}`;
}

/**
 * Subscriber count for a deduplicated job. Bumped on every claim/join,
 * decremented on every release (cancel or terminal poll). When it reaches
 * zero the job is eligible for actual cancellation and slot cleanup.
 */
function refCountKey(jobId: string): string {
    return `job:${jobId}:refcount`;
}

// Upstash는 HTTP REST 기반 — TCP 연결 없음, 함수마다 인스턴스 생성해도 성능 영향 없음.
async function withJobRedis<T>(
    fn: (redis: JobRedisClient) => Promise<T>,
    fallback: T
): Promise<T> {
    const redis = createJobRedis();
    return redis !== null ? fn(redis) : Promise.resolve(fallback);
}

// Upstash REST client는 값을 자동으로 직렬화/역직렬화한다.
// set(key, object) → JSON 문자열로 저장, get(key) → 파싱된 객체로 반환.
// 따라서 JSON.stringify/JSON.parse를 수동으로 호출하지 않는다.

/**
 * Persist a job's metadata (`symbol`, `timeframe`, `lastClose`, etc.) under a 1-hour TTL.
 *
 * Called by `submitAnalysis` immediately after generating the `jobId`. The
 * metadata is later read by `pollAnalysis` to drive cache-key construction
 * and ATR-aware reconciliation.
 *
 * No-op when Upstash env is not configured.
 *
 * @param jobId - The job identifier.
 * @param meta - The metadata payload.
 */
export async function setJobMeta(jobId: string, meta: JobMeta): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(metaKey(jobId), meta, JOB_TTL_OPTS);
    }, undefined);
}

/**
 * Read the current job status (`processing` / `done` / `error`).
 *
 * @param jobId - The job identifier.
 * @returns The current status, or `null` when no record exists (TTL expired
 *   or never set) or Upstash env is not configured.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
    return withJobRedis(redis => redis.get<JobStatus>(statusKey(jobId)), null);
}

/**
 * Read the worker's raw JSON result for a completed job.
 *
 * The Upstash REST client deserializes the stored JSON automatically, so
 * the returned value is already a `Record<string, unknown>` (typically the
 * shape of `RawAnalysisResponse`).
 *
 * @param jobId - The job identifier.
 * @returns The parsed result object, or `null` when no result is stored
 *   or Upstash env is not configured.
 */
export async function getJobResult(
    jobId: string
): Promise<Record<string, unknown> | null> {
    return withJobRedis(
        redis => redis.get<Record<string, unknown>>(resultKey(jobId)),
        null
    );
}

/**
 * Read the error message stored for a failed job.
 *
 * @param jobId - The job identifier.
 * @returns The error string, or `null` when none is stored or Upstash env
 *   is not configured.
 */
export async function getJobError(jobId: string): Promise<string | null> {
    return withJobRedis(redis => redis.get<string>(errorKey(jobId)), null);
}

/**
 * Read the metadata previously written by {@link setJobMeta}.
 *
 * @param jobId - The job identifier.
 * @returns The metadata, or `null` when no record exists or Upstash env is
 *   not configured.
 */
export async function getJobMeta(jobId: string): Promise<JobMeta | null> {
    return withJobRedis(redis => redis.get<JobMeta>(metaKey(jobId)), null);
}

/**
 * Update the job status. Worker writes `processing` on pickup and
 * transitions to `done` or `error` on completion.
 *
 * Stored under a 1-hour TTL.
 *
 * No-op when Upstash env is not configured.
 *
 * @param jobId - The job identifier.
 * @param status - The new status.
 */
export async function setJobStatus(
    jobId: string,
    status: JobStatus
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(statusKey(jobId), status, JOB_TTL_OPTS);
    }, undefined);
}

/**
 * Persist the worker's raw JSON result. Stored under a 1-hour TTL.
 *
 * Called by the worker immediately before transitioning the status to
 * `done`. The Upstash REST client serializes the object as JSON
 * automatically — do not stringify before calling.
 *
 * No-op when Upstash env is not configured.
 *
 * @param jobId - The job identifier.
 * @param result - The result payload (typically `RawAnalysisResponse`).
 */
export async function setJobResult(
    jobId: string,
    result: Record<string, unknown>
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(resultKey(jobId), result, JOB_TTL_OPTS);
    }, undefined);
}

/**
 * Persist a worker error message. Stored under a 1-hour TTL.
 *
 * Called by the worker immediately before transitioning the status to
 * `error`.
 *
 * No-op when Upstash env is not configured.
 *
 * @param jobId - The job identifier.
 * @param message - Human-readable error description shown to the consumer.
 */
export async function setJobError(
    jobId: string,
    message: string
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(errorKey(jobId), message, JOB_TTL_OPTS);
    }, undefined);
}

/**
 * Mark a job as cancelled. Worker should consult {@link isJobCancelled}
 * between expensive steps and abort early when set.
 *
 * Stored under a 1-hour TTL — long enough to outlive any reasonable worker
 * run, then auto-cleaned.
 *
 * No-op when Upstash env is not configured.
 *
 * @param jobId - The job identifier.
 */
export async function cancelJob(jobId: string): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(cancelledKey(jobId), '1', JOB_TTL_OPTS);
    }, undefined);
}

/**
 * Check whether {@link cancelJob} has been called for a job.
 *
 * @param jobId - The job identifier.
 * @returns `true` when the cancel flag is set; `false` when not set or
 *   Upstash env is not configured (so workers proceed normally without
 *   Redis).
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
    return withJobRedis(
        async redis => (await redis.get<string>(cancelledKey(jobId))) === '1',
        false
    );
}

/**
 * Delete every Redis key associated with a job (status, result, error,
 * meta, cancelled, refcount).
 *
 * Called from `pollAnalysis` once a terminal outcome (`done` or `error`)
 * has been observed and consumed by the caller. Cleanup failures are
 * tolerated — TTL ensures keys disappear within an hour either way.
 *
 * No-op when Upstash env is not configured.
 *
 * @param jobId - The job identifier.
 */
export async function cleanupJob(jobId: string): Promise<void> {
    return withJobRedis(async redis => {
        await redis.del(
            statusKey(jobId),
            resultKey(jobId),
            errorKey(jobId),
            metaKey(jobId),
            cancelledKey(jobId),
            refCountKey(jobId)
        );
    }, undefined);
}

/**
 * @internal Outcome of an in-flight job claim attempt — see
 * {@link claimOrJoinInFlightJob}.
 *
 * `claimed` means the caller is the first submitter for `cacheKey` and owns
 * the worker dispatch responsibility. `joined` means an existing job was
 * already in flight for the same input; the caller should reuse `jobId`
 * without creating a new worker job.
 */
export interface InFlightClaim {
    status: 'claimed' | 'joined';
    jobId: string;
}

/**
 * Hard cap on the TOCTOU retry loop in {@link claimOrJoinInFlightJob} —
 * total attempts (initial + retries). Each iteration should be
 * microsecond-narrow; needing more than a few is a pathological contention
 * storm and is treated as "give up and claim fresh".
 */
const CLAIM_OR_JOIN_MAX_ATTEMPTS = 3;

/**
 * @internal Atomically claim an in-flight slot for `cacheKey`, or join an
 * existing one.
 *
 * Backs the in-flight dedup mechanism: when two submitters race for the
 * same `cacheKey` (same symbol/timeframe/model + input hash), only the
 * first allocates a worker job; the rest piggyback on its `jobId`. Both
 * paths bump the subscriber refcount so a single cancel from one client
 * cannot terminate a job another client still wants — see
 * {@link releaseInFlightJob}.
 *
 * Implementation:
 * 1. `SET inflight:{cacheKey} {newJobId} NX EX 1h` — atomic claim. Success
 *    returns `{ status: 'claimed', jobId: newJobId }`; the caller dispatches
 *    to the worker.
 * 2. On contention, read the existing jobId from `inflight:{cacheKey}` and
 *    `INCR refcount:{existingJobId}`. The `EXPIRE` after `INCR` keeps the
 *    refcount key on the same 1h TTL as the rest of the job keys.
 * 3. If the inflight key disappeared between steps 1 and 2 (e.g. job
 *    completed, slot released), fall through to a bounded retry. After
 *    {@link CLAIM_OR_JOIN_MAX_ATTEMPTS} total attempts the caller is treated
 *    as a fresh claimer with its own jobId rather than looping further —
 *    losing a small amount of dedup is preferable to a pathological
 *    contention storm holding the request open.
 *
 * No-op (returns `claimed` with the requested jobId) when Upstash env is not
 * configured — without Redis there is no shared state to dedup against, so
 * each submitter proceeds with its own jobId as before.
 *
 * @param cacheKey - Stable hash of the analysis inputs; same key ⇒ same job.
 * @param newJobId - The jobId to register if this caller wins the claim.
 * @returns `{ status, jobId }` describing whether a new job was started or
 *   joined.
 */
export async function claimOrJoinInFlightJob(
    cacheKey: string,
    newJobId: string
): Promise<InFlightClaim> {
    return withJobRedis<InFlightClaim>(
        async redis => {
            for (
                let attempt = 0;
                attempt < CLAIM_OR_JOIN_MAX_ATTEMPTS;
                attempt++
            ) {
                const claimed = await redis.setNx(
                    inFlightKey(cacheKey),
                    newJobId,
                    {
                        ex: JOB_TTL_SECONDS,
                    }
                );
                if (claimed !== null) {
                    await redis.incr(refCountKey(newJobId));
                    await redis.expire(refCountKey(newJobId), JOB_TTL_SECONDS);
                    return { status: 'claimed', jobId: newJobId };
                }
                const existingJobId = await redis.get<string>(
                    inFlightKey(cacheKey)
                );
                if (existingJobId !== null) {
                    await redis.incr(refCountKey(existingJobId));
                    await redis.expire(
                        refCountKey(existingJobId),
                        JOB_TTL_SECONDS
                    );
                    return { status: 'joined', jobId: existingJobId };
                }
                // The slot was released between our NX attempt and the GET.
                // Loop body retries the SET NX so we never attach to a stale job.
            }
            // Exhausted retries — treat as fresh claim. Loses dedup for this one
            // call but keeps the call stack and Redis traffic bounded.
            //
            // Refcount must still be initialized here so that subsequent
            // joiners who DECR via cancel never push the count below zero
            // and prematurely cancel a job other clients still depend on.
            await redis.incr(refCountKey(newJobId));
            await redis.expire(refCountKey(newJobId), JOB_TTL_SECONDS);
            return { status: 'claimed', jobId: newJobId };
        },
        { status: 'claimed', jobId: newJobId }
    );
}

/**
 * @internal Decrement the subscriber count for a deduplicated job. Returns
 * `true` when the caller was the last subscriber and the worker job is now
 * safe to cancel.
 *
 * Backs the cancel-refcount half of the dedup mechanism: when N clients
 * share a `jobId`, each cancel only releases one subscription. Only the
 * final release should propagate to the worker `/cancel` endpoint and the
 * Redis cancellation flag — otherwise one user's tab close would terminate
 * another user's analysis.
 *
 * Implementation: a single `DECR` on `refcount:{jobId}`. The atomic decrement
 * means concurrent releases linearize correctly — at most one caller observes
 * the transition to `0` and is signalled `true`. When refcount goes negative
 * (more releases than claims, e.g. release after the slot was already
 * cleared) the function still returns `true` so the caller still posts the
 * worker cancel — there is no harm in re-cancelling an already-cancelled or
 * completed job.
 *
 * Returns `true` when Upstash env is not configured — without shared state
 * there is no dedup, so every cancel must propagate.
 *
 * @param jobId - The shared `jobId` whose subscription is being released.
 * @returns `true` when this caller is responsible for the actual cancel.
 */
export async function releaseInFlightJob(jobId: string): Promise<boolean> {
    return withJobRedis(async redis => {
        const remaining = await redis.decr(refCountKey(jobId));
        return remaining <= 0;
    }, true);
}

/**
 * @internal Release the in-flight slot for `jobId` and reset its refcount.
 *
 * Called from `pollAnalysis` and the other axis polls when a terminal status
 * (`done` or `error`) is observed: at that point the worker job is finished,
 * so the slot should be freed for the next submitter and the refcount reset
 * regardless of how many subscribers polled. Without this, a stale
 * `inflight:{cacheKey}` key would force later submitters to attach to a job
 * that has already produced its result.
 *
 * Compare-and-delete: only clears `inflight:{cacheKey}` when its current
 * value is still `jobId`. Avoids wiping a fresh slot that a later submitter
 * already claimed for the same `cacheKey`.
 *
 * @param jobId - The completed (or errored) job's identifier.
 * @param cacheKey - The cache key used during claim, read from job meta.
 *   Pass `undefined` to skip the in-flight slot release (refcount only).
 */
export async function clearInFlightJob(
    jobId: string,
    cacheKey: string | undefined
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.del(refCountKey(jobId));
        if (cacheKey !== undefined) {
            const current = await redis.get<string>(inFlightKey(cacheKey));
            if (current === jobId) {
                await redis.del(inFlightKey(cacheKey));
            }
        }
    }, undefined);
}
