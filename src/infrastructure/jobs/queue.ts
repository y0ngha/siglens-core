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
 * meta, cancelled).
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
            cancelledKey(jobId)
        );
    }, undefined);
}
