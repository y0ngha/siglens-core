import { fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { MS_PER_SECOND } from '@/domain/constants/time';
import { cancelJob } from '@/infrastructure/jobs/queue';
import { tryReadWorkerConfig } from '@/infrastructure/market/config';

const CANCEL_ANALYSIS_JOB_TIMEOUT_MS = 5 * MS_PER_SECOND;

/**
 * Cancel an in-flight analysis job.
 *
 * Sends two best-effort cancellation signals:
 * 1. Marks the job as cancelled in Redis so {@link pollAnalysis} reports it.
 * 2. If a worker URL is configured, dispatches a background POST to `/cancel`
 *    to abort the in-progress AI call on the worker side (5-second timeout).
 *
 * Both signals are best-effort: rejections are logged via `console.warn` and
 * swallowed, so this never throws even if Redis is down or the worker
 * returns a 4xx/5xx. Callers can omit error handling. Stale jobs that
 * escape cancellation are cleaned up naturally via Redis TTL.
 *
 * @param jobId - The `jobId` returned by {@link submitAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker `/cancel` request can continue after the response.
 * @returns Resolves once the Redis cancellation signal has settled.
 *
 * @see submitAnalysis
 * @see pollAnalysis
 */
export async function cancelAnalysisJob(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<void> {
    const workerConfig = tryReadWorkerConfig();

    if (workerConfig !== null) {
        // 워커가 설정된 경우 /cancel 엔드포인트에도 신호를 보내 진행 중인 AI 호출을 즉시 중단한다.
        // AbortSignal.timeout으로 5초 제한 — 취소 요청이 클라이언트 흐름을 오래 잡지 않도록 한다.
        fireAndForget(
            fetch(`${workerConfig.workerUrl}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Worker-Secret': workerConfig.workerSecret,
                },
                body: JSON.stringify({ jobId }),
                signal: AbortSignal.timeout(CANCEL_ANALYSIS_JOB_TIMEOUT_MS),
            }).catch(reason =>
                console.warn(
                    '[cancelAnalysisJob] Failed to signal cancellation:',
                    jobId,
                    reason
                )
            ),
            options
        );
    }

    // Redis 장애는 클라이언트에 전파하지 않는다. 워커 작업은 TTL 만료 후 자연 정리된다.
    await cancelJob(jobId).catch(reason =>
        console.warn(
            '[cancelAnalysisJob] Failed to signal cancellation:',
            jobId,
            reason
        )
    );
}
