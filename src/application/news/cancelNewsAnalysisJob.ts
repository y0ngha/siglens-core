/**
 * Cancel an in-flight news analysis job.
 *
 * Delegates entirely to {@link cancelAnalysisJob} — the news analysis
 * worker uses the same `/cancel` endpoint and Redis job state as the
 * technical analysis worker. Cancellation is a best-effort signal: it sets
 * the cancellation flag in Redis (so the worker can self-abort on its next
 * `isJobCancelled` check) and, if configured, posts to the worker's
 * `/cancel` endpoint. Errors are logged and swallowed.
 *
 * Cancel-after-poll behavior: cancellation does not directly transition the
 * job status, so {@link pollNewsAnalysis} (and {@link pollNewsCardAnalysis})
 * may continue to return `processing` until the worker observes the cancel
 * signal. Consumers polling after cancel MUST bound the loop with their own
 * timeout to avoid indefinite polling if the worker is dead or unreachable.
 *
 * @param jobId - The `jobId` returned by {@link submitNewsAnalysis} or
 *   {@link submitNewsCardAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker `/cancel` request can continue after the response.
 * @returns A `Promise<void>` that resolves once the Redis cancellation
 *   signal has settled. The promise resolves even if the underlying signal
 *   failed (errors are logged, not thrown), so a successful resolution
 *   does not imply the worker has actually stopped.
 *
 * @see submitNewsAnalysis
 * @see pollNewsAnalysis
 * @see cancelAnalysisJob
 */
export { cancelAnalysisJob as cancelNewsAnalysisJob } from '@/application/market/cancelAnalysisJob';
