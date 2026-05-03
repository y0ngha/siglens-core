/**
 * Cancel an in-flight overall analysis job.
 *
 * Delegates entirely to {@link cancelAnalysisJob} — the overall analysis
 * worker uses the same `/cancel` endpoint and Redis job state as the
 * technical analysis worker. Cancellation is a best-effort signal: it sets
 * the cancellation flag in Redis (so the worker can self-abort on its next
 * `isJobCancelled` check) and, if configured, posts to the worker's
 * `/cancel` endpoint. Errors are logged and swallowed.
 *
 * Cancel-after-poll behavior: cancellation does not directly transition the
 * job status, so {@link pollOverallAnalysis} may continue to return
 * `processing` until the worker observes the cancel signal. Consumers
 * polling after cancel MUST bound the loop with their own timeout to avoid
 * indefinite polling if the worker is dead or unreachable.
 *
 * Pending-dependencies caveat: this function only cancels overall jobs
 * keyed by an overall `jobId`. When {@link submitOverallAnalysis} returns
 * `status: 'pending_dependencies'`, there is NO overall `jobId` yet — each
 * pending axis (technical / fundamental / news) has its own per-axis job
 * id in `pendingJobs`. To cancel those, consumers must call the matching
 * per-axis cancel function for each entry:
 * - technical → {@link cancelAnalysisJob}
 * - fundamental → {@link cancelFundamentalAnalysisJob}
 * - news → {@link cancelNewsAnalysisJob}
 *
 * @example
 * ```ts
 * const submitted = await submitOverallAnalysis(input);
 * if (submitted.status === 'pending_dependencies') {
 *   // Per-axis cancel — no overall jobId exists yet. `pendingJobs` is keyed
 *   // by axis name; each value is the per-axis jobId or undefined when that
 *   // axis was already cached (no job to cancel).
 *   const { technical, fundamental, news } = submitted.pendingJobs;
 *   await Promise.all([
 *     technical !== undefined ? cancelAnalysisJob(technical) : undefined,
 *     fundamental !== undefined
 *       ? cancelFundamentalAnalysisJob(fundamental)
 *       : undefined,
 *     news !== undefined ? cancelNewsAnalysisJob(news) : undefined,
 *   ]);
 * } else if (submitted.status === 'submitted') {
 *   await cancelOverallAnalysisJob(submitted.jobId);
 * }
 * ```
 *
 * @param jobId - The overall `jobId` returned by {@link submitOverallAnalysis}
 *   when its `status` is `'submitted'`. NOT applicable to the
 *   `'pending_dependencies'` case (see above).
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker `/cancel` request can continue after the response.
 * @returns A `Promise<void>` that resolves once the Redis cancellation
 *   signal has settled. The promise resolves even if the underlying signal
 *   failed (errors are logged, not thrown), so a successful resolution
 *   does not imply the worker has actually stopped.
 *
 * @see submitOverallAnalysis
 * @see pollOverallAnalysis
 * @see cancelAnalysisJob
 * @see cancelFundamentalAnalysisJob
 * @see cancelNewsAnalysisJob
 */
export { cancelAnalysisJob as cancelOverallAnalysisJob } from '@/application/market/cancelAnalysisJob';
