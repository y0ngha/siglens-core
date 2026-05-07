import { fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { MS_PER_SECOND } from '@/domain/constants/time';
import { cancelJob, releaseInFlightJob } from '@/infrastructure/jobs/queue';
import { tryReadWorkerConfig } from '@/infrastructure/market/config';

const CANCEL_ANALYSIS_JOB_TIMEOUT_MS = 5 * MS_PER_SECOND;

/**
 * Cancel an in-flight analysis job, with subscriber refcount semantics.
 *
 * Issue #81 dedup means multiple submitters may share a single `jobId`.
 * Each submitter holds one subscription via {@link claimOrJoinInFlightJob};
 * each cancel releases exactly one subscription via
 * {@link releaseInFlightJob}. Only the LAST cancel — the one that takes the
 * refcount to zero — propagates to the actual worker job. Otherwise one
 * client closing a tab would terminate analyses other clients still want.
 *
 * When the cancel is the last subscriber's, sends two best-effort signals:
 * 1. Marks the job as cancelled in Redis (sets the `cancelledKey`) so the
 *    worker can observe it via `isJobCancelled` and self-abort. This does
 *    NOT call `setJobStatus`, so the job's status stays whatever the worker
 *    last wrote (typically `processing`).
 * 2. If a worker URL is configured, dispatches a background POST to `/cancel`
 *    to abort the in-progress AI call on the worker side (5-second timeout).
 *
 * When other subscribers remain, `releaseInFlightJob` returns `false` and
 * this function returns immediately without touching the worker — the
 * remaining subscribers' analysis proceeds unaffected. When Upstash is not
 * configured, refcount is unavailable and every cancel propagates (legacy
 * behavior).
 *
 * Both signals are best-effort: rejections are logged via `console.warn` and
 * swallowed, so this never throws even if Redis is down or the worker
 * returns a 4xx/5xx. Callers can omit error handling. Stale jobs that
 * escape cancellation are cleaned up naturally via Redis TTL.
 *
 * Cancel-after-poll behavior: because cancellation only sets the
 * `cancelledKey` and never directly transitions the job's status,
 * {@link pollAnalysis} will continue to return `processing` after a cancel
 * until the worker observes the cancel signal on its next `isJobCancelled`
 * check (and only then transitions the status to `error`/`done`). If the
 * worker is dead, unreachable, or already finished, the status may never
 * change and is reaped only by Redis TTL. Consumers that poll after
 * cancellation MUST bound the loop with their own timeout to avoid
 * indefinite polling.
 *
 * @param jobId - The `jobId` returned by {@link submitAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker `/cancel` request can continue after the response.
 * @returns A `Promise<void>` that resolves once the cancellation has settled
 *   (or been suppressed because other subscribers remain). The promise
 *   resolves even if the signal failed (errors are logged, not thrown), so
 *   a successful resolution does not imply the worker has actually stopped.
 *
 * @see submitAnalysis
 * @see pollAnalysis
 * @see releaseInFlightJob
 */
export async function cancelAnalysisJob(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<void> {
    const isLastSubscriber = await releaseInFlightJob(jobId).catch(reason => {
        console.warn(
            '[cancelAnalysisJob] Failed to release subscriber refcount:',
            jobId,
            reason
        );
        // Refcount lookup failures fall through to a propagated cancel — losing
        // dedup is preferable to leaking a worker job that nobody can stop.
        return true;
    });

    if (!isLastSubscriber) {
        // Other subscribers are still polling this job — don't terminate it.
        return;
    }

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
