import { createJobRedis } from '@/infrastructure/jobs/redis';
import type {
    JobMeta,
    JobRedisClient,
    JobStatus,
} from '@/infrastructure/jobs/types';
import { SECONDS_PER_HOUR } from '@/domain/constants/time';

// Upstash는 HTTP REST 기반 — TCP 연결 없음, 함수마다 인스턴스 생성해도 성능 영향 없음.
const JOB_TTL_SECONDS = SECONDS_PER_HOUR;

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

export async function setJobMeta(jobId: string, meta: JobMeta): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(metaKey(jobId), meta, { ex: JOB_TTL_SECONDS });
    }, undefined);
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
    return withJobRedis(redis => redis.get<JobStatus>(statusKey(jobId)), null);
}

export async function getJobResult(
    jobId: string
): Promise<Record<string, unknown> | null> {
    return withJobRedis(
        redis => redis.get<Record<string, unknown>>(resultKey(jobId)),
        null
    );
}

export async function getJobError(jobId: string): Promise<string | null> {
    return withJobRedis(redis => redis.get<string>(errorKey(jobId)), null);
}

export async function getJobMeta(jobId: string): Promise<JobMeta | null> {
    return withJobRedis(redis => redis.get<JobMeta>(metaKey(jobId)), null);
}

export async function setJobStatus(
    jobId: string,
    status: JobStatus
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(statusKey(jobId), status, { ex: JOB_TTL_SECONDS });
    }, undefined);
}

export async function setJobResult(
    jobId: string,
    result: Record<string, unknown>
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(resultKey(jobId), result, {
            ex: JOB_TTL_SECONDS,
        });
    }, undefined);
}

export async function setJobError(
    jobId: string,
    message: string
): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(errorKey(jobId), message, {
            ex: JOB_TTL_SECONDS,
        });
    }, undefined);
}

export async function cancelJob(jobId: string): Promise<void> {
    return withJobRedis(async redis => {
        await redis.set(cancelledKey(jobId), '1', {
            ex: JOB_TTL_SECONDS,
        });
    }, undefined);
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
    return withJobRedis(
        async redis => (await redis.get<string>(cancelledKey(jobId))) === '1',
        false
    );
}

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
