import { MS_PER_SECOND } from '@/domain/constants/time';
import { cancelJob } from '@/infrastructure/jobs/queue';
import { tryReadWorkerConfig } from '@/infrastructure/market/config';

const CANCEL_ANALYSIS_JOB_TIMEOUT_MS = 5 * MS_PER_SECOND;

/**
 * Cancel an in-flight analysis job.
 *
 * Sends two parallel signals and awaits both via `Promise.allSettled`:
 * 1. Marks the job as cancelled in Redis so {@link pollAnalysis} reports it.
 * 2. If a worker URL is configured, POSTs `/cancel` to abort the in-progress
 *    AI call on the worker side (5-second timeout).
 *
 * Both signals are best-effort: rejections are logged via `console.warn` and
 * swallowed, so this never throws even if Redis is down or the worker
 * returns a 4xx/5xx. Callers can omit error handling. Stale jobs that
 * escape cancellation are cleaned up naturally via Redis TTL.
 *
 * @param jobId - The `jobId` returned by {@link submitAnalysis}.
 * @returns Resolves once both cancellation signals have settled (success or failure).
 *
 * @see submitAnalysis
 * @see pollAnalysis
 */
export async function cancelAnalysisJob(jobId: string): Promise<void> {
    const workerConfig = tryReadWorkerConfig();

    // 워커가 설정된 경우 /cancel 엔드포인트에도 신호를 보내 진행 중인 AI 호출을 즉시 중단한다.
    // AbortSignal.timeout으로 5초 제한 — 취소 요청이 클라이언트 흐름을 오래 잡지 않도록 한다.
    const tasks: Promise<unknown>[] = [
        cancelJob(jobId),
        ...(workerConfig !== null
            ? [
                  fetch(`${workerConfig.workerUrl}/cancel`, {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                          'X-Worker-Secret': workerConfig.workerSecret,
                      },
                      body: JSON.stringify({ jobId }),
                      signal: AbortSignal.timeout(
                          CANCEL_ANALYSIS_JOB_TIMEOUT_MS
                      ),
                  }),
              ]
            : []),
    ];

    // 취소는 fire-and-forget — Redis 장애나 워커 에러 시 클라이언트 흐름을 막지 않는다.
    // HTTP 4xx/5xx도 무시한다 — 워커 작업은 TTL 만료 후 자연 정리된다.
    const results = await Promise.allSettled(tasks);
    results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .forEach(r =>
            console.warn(
                '[cancelAnalysisJob] Failed to signal cancellation:',
                jobId,
                r.reason
            )
        );
}
