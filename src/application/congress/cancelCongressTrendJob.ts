/**
 * Cancel an in-flight congressional-trade trend analysis job.
 *
 * Delegates entirely to {@link cancelAnalysisJob} — the congress analysis worker
 * uses the same `/cancel` endpoint and Redis job state as the technical and
 * financials analysis workers. Cancellation is a best-effort signal: it sets the
 * cancellation flag in Redis (so the worker can self-abort on its next
 * `isJobCancelled` check) and, if configured, posts to the worker's `/cancel`
 * endpoint. Errors are logged and swallowed.
 *
 * Cancel-after-poll behavior: cancellation does not directly transition the job
 * status, so {@link pollCongressTrend} may continue to return `processing` until
 * the worker observes the cancel signal. Consumers polling after cancel MUST
 * bound the loop with their own timeout.
 *
 * @param jobId - The `jobId` returned by {@link submitCongressTrend}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil` so
 *   the worker `/cancel` request can continue after the response.
 * @returns A `Promise<void>` that resolves once the Redis cancellation signal
 *   has settled (even if the underlying signal failed — errors are logged).
 *
 * @see submitCongressTrend
 * @see pollCongressTrend
 * @see cancelAnalysisJob
 */
export { cancelAnalysisJob as cancelCongressTrendJob } from '@/application/market/cancelAnalysisJob';
